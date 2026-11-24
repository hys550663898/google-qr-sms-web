"use strict";

// The in-page agent: everything the extension did across content.js
// and background.js, merged into one self-contained async function
// that the server evaluates inside the QR-code tab via
// Runtime.evaluate.
//
// It must reference page globals only (window, document, location,
// fetch, BarcodeDetector, ...) — it is serialized with
// Function.prototype.toString and re-created inside the page.
//
// Adapted from havenicec/google-qr-sms-helper (MIT): QR extraction,
// the MypxBd / YDtwf batchexecute sequence, the [3,null,4] fallback
// check, and the selection-page URL construction are the extension's.
// Difference: instead of navigating itself it returns the target URL,
// and the server navigates with CDP Page.navigate, so the result is
// observable even though navigation tears down the page context.
//
// Returns { ok, targetUrl?, stage?, error?, ydSnippet?, log: [...] }.

async function pageAgentMain() {
  const log = [];
  const note = (s) => log.push(s);

  async function extractQrUrlFromPage() {
    if ("BarcodeDetector" in window) {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const mediaEls = Array.from(document.querySelectorAll("img, canvas"));
      for (const el of mediaEls) {
        try {
          if (el.clientWidth > 80 && el.clientHeight > 80) {
            const c = document.createElement("canvas");
            c.width = el.naturalWidth || el.clientWidth || 300;
            c.height = el.naturalHeight || el.clientHeight || 300;
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(el, 0, 0, c.width, c.height);
            const codes = await detector.detect(c);
            if (codes && codes.length > 0 && codes[0].rawValue) {
              return codes[0].rawValue;
            }
          }
        } catch (e) {}
      }
    }
    const bodyText = document.body.innerText || "";
    const shortMatch = bodyText.match(/g\.co\/verify\/[A-Za-z0-9_-]+/);
    if (shortMatch) {
      return "https://" + shortMatch[0];
    }
    const html = document.documentElement.innerHTML;
    const m = html.match(
      /https:\/\/accounts\.google\.com\/devicephoneverification\/begin\?[^"'\s<>]+/,
    );
    if (m) return m[0].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
    throw new Error("未能在当前页面识别到二维码，请确认二维码图片已加载");
  }

  async function handleDowngrade(qrUrl) {
    let targetUrl = qrUrl;
    if (targetUrl.includes("g.co/verify/")) {
      note("展开 g.co/verify 短链");
      const shortResp = await fetch(targetUrl, { credentials: "include" });
      const shortHtml = await shortResp.text();
      const m = shortHtml.match(/devicephoneverification\/begin\?[^"'\s<>]+/);
      if (m) {
        targetUrl =
          "https://accounts.google.com/" +
          m[0]
            .replace(/\\u003d/g, "=")
            .replace(/\\u0026/g, "&")
            .replace(/&quot;.*$/, "");
      }
    }

    note("读取验证会话页，提取 SNlM0e / Qzxixc / tl");
    const initResp = await fetch(targetUrl, { credentials: "include" });
    const html = await initResp.text();

    const atMatch = html.match(/"SNlM0e":"([^"]+)"/);
    const dshMatch = html.match(/"Qzxixc":"([^"]+)"/);
    let tl = "";
    const ds0Match = html.match(/key:\s*['"]ds:0['"][^}]*data:\["([^"]+)"/);
    if (ds0Match) {
      tl = ds0Match[1];
    } else {
      const tlMatch = html.match(/ADG-[A-Za-z0-9_-]+/);
      if (tlMatch) tl = tlMatch[0];
    }
    if (!atMatch || !dshMatch || !tl) {
      throw new Error("未能从二维码页面提取出 SNlM0e / Qzxixc / TL 参数");
    }
    const at = atMatch[1];
    const dsh = dshMatch[1];

    async function callRpc(rpcid, payload, sourcePath) {
      const url = `https://accounts.google.com/devicephoneverification/_/DevicePhoneVerificationUi/data/batchexecute?rpcids=${rpcid}&source-path=${sourcePath}&hl=en&tl=${encodeURIComponent(tl)}&rt=c`;
      const body = new URLSearchParams({
        "f.req": JSON.stringify([[[rpcid, JSON.stringify(payload), null, "generic"]]]),
        at: at,
      });
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: body.toString(),
      });
      return await r.text();
    }

    note("发送 MypxBd：登记扫码设备、发起验证会话");
    await callRpc(
      "MypxBd",
      [tl, dsh, false, null, null, false, null, null, "browser"],
      "%2Fdevicephoneverification%2Finitiate",
    );

    note("读取 consent 页，提取本次验证的 UUID");
    const consentUrl = `https://accounts.google.com/devicephoneverification/consent?flow=browser&plt&dsh=${encodeURIComponent(dsh)}&hl=en&tl=${encodeURIComponent(tl)}`;
    const consentResp = await fetch(consentUrl, { credentials: "include" });
    const consentHtml = await consentResp.text();
    const uuidMatch = consentHtml.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
    if (!uuidMatch) {
      throw new Error("未能从 consent 页面提取到 UUID");
    }
    const rid = uuidMatch[0];

    note("发送 YDtwf：推进设备引导流程，等待 [3,null,4] 回退状态");
    const ydResp = await callRpc(
      "YDtwf",
      [null, rid, dsh, 7, null, tl, false],
      "%2Fdevicephoneverification%2Fmodacintro",
    );
    return { rid, ydResp };
  }

  try {
    note("识别页面上的二维码");
    const qrUrl = await extractQrUrlFromPage();
    note("二维码内容已提取，开始在后台会话中执行降级");
    const { ydResp } = await handleDowngrade(qrUrl);
    if (!ydResp.includes("[3,null,4]")) {
      return {
        ok: false,
        stage: "ydtwf",
        error: "服务端未返回 [3,null,4] 回退状态",
        ydSnippet: ydResp.slice(0, 120),
        log,
      };
    }
    note("[3,null,4] 已确认，会话进入回退分支");

    const params = new URLSearchParams(location.search);
    let cont = params.get("continue") || "";
    let targetUrl = "";
    if (cont && cont.startsWith("https://accounts.google.com/uplevelingstep/")) {
      cont = cont.replace(/&idv_xdevice=[^&]*/g, "");
      cont = cont.replace(/([?&])authuser(&|$)/, "$1authuser=0$2");
      targetUrl = cont + "&idv_xdevice=1";
    } else {
      targetUrl = location.href.replace("/challenge/iap/qrcode", "/challenge/iap");
      targetUrl = targetUrl.replace(/&idv_xdevice=[^&]*/g, "") + "&idv_xdevice=1";
    }
    note("已构造验证方式选择页地址，交由本地服务跳转");
    return { ok: true, targetUrl, log };
  } catch (e) {
    return { ok: false, stage: "exception", error: String((e && e.message) || e), log };
  }
}

module.exports = {
  pageAgentMain,
  pageAgentExpression: "(" + pageAgentMain.toString() + ")()",
};
