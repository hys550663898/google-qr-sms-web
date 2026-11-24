"use strict";

// google-qr-sms-web: a local web service that reproduces the
// google-qr-sms-helper extension's downgrade without an extension.
//
// How: the user's own Chrome runs with a remote-debugging port. This
// server talks to it over CDP (Chrome DevTools Protocol):
//   * Fetch interception rewrites request headers exactly like the
//     extension's declarativeNetRequest rules (iPad Mini UA, no
//     Sec-CH-UA*, iPhone UA for /devicephoneverification/*).
//   * Page.addScriptToEvaluateOnNewDocument injects the navigator
//     spoof (the extension's ua_spoof.js).
//   * The downgrade RPC sequence runs inside the QR tab itself, with
//     the tab's own cookies and network identity — the two things a
//     hosted web service could never provide.
//
// The server binds 127.0.0.1 only and stores nothing. The only
// outbound traffic is your browser's own requests to Google.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { listTargets, cdpVersion } = require("./lib/cdp");
const { attachSpoofedSession } = require("./lib/session");
const { pageAgentExpression } = require("./lib/page-agent");

const HTTP_PORT = Number(process.env.PORT || 8787);
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");

// targetId -> session (from attachSpoofedSession)
const sessions = new Map();

function classifyTab(t) {
  const url = t.url || "";
  if (url.includes("/challenge/iap/qrcode")) return "qr";
  if (url.startsWith("https://console.cloud.google.com/")) return "console";
  if (url.startsWith("https://accounts.google.com/")) return "accounts";
  return "other";
}

async function attachSession(target) {
  const existing = sessions.get(target.id);
  if (existing) return existing;
  const session = await attachSpoofedSession(target);
  sessions.set(target.id, session);
  session.client.onClose = () => sessions.delete(target.id);
  return session;
}

async function findTarget(port, targetId) {
  const targets = await listTargets(port);
  return targets.find((t) => t.id === targetId) || null;
}

async function runDowngrade(port, targetId) {
  const target = await findTarget(port, targetId);
  if (!target) return { ok: false, error: "找不到该标签页，请刷新状态后重试" };
  const { client } = await attachSession(target);
  const evaluated = await client.send(
    "Runtime.evaluate",
    { expression: pageAgentExpression, awaitPromise: true, returnByValue: true },
    120000,
  );
  if (evaluated.exceptionDetails) {
    const desc =
      evaluated.exceptionDetails.exception?.description ||
      evaluated.exceptionDetails.text ||
      "页面内脚本执行失败";
    return { ok: false, stage: "evaluate", error: desc, log: [] };
  }
  const result = evaluated.result?.value || { ok: false, error: "页面未返回结果" };
  if (result.ok && result.targetUrl) {
    await client.send("Page.navigate", { url: result.targetUrl });
    result.log = [...(result.log || []), "已跳转到验证方式选择页，iPad 环境伪装保持中"];
    result.spoofing = true;
  }
  return result;
}

const WARMUP_SHELL_CLICK = `(() => {
  const shellBtn = document.querySelector('button[aria-label*="Cloud Shell"], button[mattooltip*="Cloud Shell"], [id*="cloudshell"]');
  if (!shellBtn) return { ok: false, error: "未找到 Cloud Shell 终端按钮，请手动点击右上角 [>_] 图标" };
  shellBtn.click();
  return { ok: true };
})()`;

const WARMUP_VERIFY_CLICK = `(() => {
  const allBtns = Array.from(document.querySelectorAll("button, a"));
  const verifyBtn = allBtns.find((b) => b.textContent.trim() === "Verify");
  if (!verifyBtn) return { ok: false, error: "尚未找到 Verify 按钮，Cloud Shell 可能还在加载，请稍后在二维码页直接降级" };
  verifyBtn.click();
  return { ok: true };
})()`;

async function runWarmup(port, targetId) {
  const target = await findTarget(port, targetId);
  if (!target) return { ok: false, error: "找不到该标签页，请刷新状态后重试" };
  const { client } = await attachSession(target);
  const log = [];
  const first = await client.send("Runtime.evaluate", {
    expression: WARMUP_SHELL_CLICK,
    returnByValue: true,
  });
  const firstVal = first.result?.value;
  if (!firstVal?.ok) return { ok: false, error: firstVal?.error || "唤起失败", log };
  log.push("已点击 Cloud Shell 终端图标，等待 Verify 弹窗");
  await new Promise((r) => setTimeout(r, 2500));
  const second = await client.send("Runtime.evaluate", {
    expression: WARMUP_VERIFY_CLICK,
    returnByValue: true,
  });
  const secondVal = second.result?.value;
  if (!secondVal?.ok) return { ok: false, error: secondVal?.error || "未找到 Verify 按钮", log };
  log.push("已点击 Verify，二维码页出现后对它执行一键降级");
  return { ok: true, log, spoofing: true };
}

async function releaseSession(targetId) {
  const session = sessions.get(targetId);
  if (!session) return { ok: true, released: false };
  sessions.delete(targetId);
  await session.release();
  return { ok: true, released: true };
}

// ---------- HTTP plumbing ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(INDEX_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      const port = Number(url.searchParams.get("port") || 9222);
      try {
        const version = await cdpVersion(port);
        const targets = await listTargets(port);
        const tabs = targets
          .filter((t) => t.type === "page")
          .map((t) => ({
            id: t.id,
            title: t.title || "",
            url: t.url || "",
            kind: classifyTab(t),
            spoofing: sessions.has(t.id),
          }));
        return sendJson(res, 200, { cdp: true, browser: version.Browser || "", tabs });
      } catch (e) {
        return sendJson(res, 200, { cdp: false, error: String(e.message || e), tabs: [] });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/downgrade") {
      const body = await readJsonBody(req);
      const port = Number(body.port || 9222);
      const result = await runDowngrade(port, String(body.targetId || ""));
      return sendJson(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/warmup") {
      const body = await readJsonBody(req);
      const port = Number(body.port || 9222);
      const result = await runWarmup(port, String(body.targetId || ""));
      return sendJson(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/release") {
      const body = await readJsonBody(req);
      const result = await releaseSession(String(body.targetId || ""));
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
});

server.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`google-qr-sms-web listening on http://127.0.0.1:${HTTP_PORT}`);
  console.log("Start Chrome with --remote-debugging-port=9222, open the QR page, then use the UI.");
});
