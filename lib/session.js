"use strict";

// A spoofed CDP session on one browser tab.
//
// Attaching does the three things the extension achieved with
// declarativeNetRequest + content scripts:
//   1. Fetch interception rewrites every accounts.google.com request
//      (iPad Mini UA, Sec-CH-UA* stripped, iPhone UA on the
//      /devicephoneverification/* sub-flow).
//   2. Network.setUserAgentOverride makes navigator + default headers
//      agree, with empty client-hint metadata.
//   3. Page.addScriptToEvaluateOnNewDocument injects the navigator
//      property spoof before page scripts on every navigation, and
//      the already-loaded document is patched immediately as well.
//
// The session stays attached after the downgrade redirect on
// purpose: the selection page and the 6-digit code submission must
// keep presenting as the same iPad, exactly like the extension's
// always-on rules. Call release() when verification is done.

const { CDPClient } = require("./cdp");
const {
  IPAD_MINI_UA,
  rewriteHeaders,
  NAVIGATOR_SPOOF_SCRIPT,
} = require("./spoof");

async function attachSpoofedSession(target, { urlPattern = "*accounts.google.com*" } = {}) {
  const client = await CDPClient.connect(target.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  client.on("Fetch.requestPaused", (params) => {
    const { requestId, request } = params;
    let headers;
    try {
      headers = rewriteHeaders(request.url, request.headers);
    } catch {
      headers = undefined;
    }
    client
      .send("Fetch.continueRequest", headers ? { requestId, headers } : { requestId })
      .catch(() => {});
  });
  await client.send("Fetch.enable", {
    patterns: [{ urlPattern, requestStage: "Request" }],
  });
  await client.send("Network.setUserAgentOverride", {
    userAgent: IPAD_MINI_UA,
    userAgentMetadata: {
      brands: [],
      fullVersionList: [],
      fullVersion: "",
      platform: "",
      platformVersion: "",
      architecture: "",
      model: "",
      mobile: true,
      bitness: "",
      wow64: false,
    },
  });
  const { identifier } = await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: NAVIGATOR_SPOOF_SCRIPT,
  });
  await client
    .send("Runtime.evaluate", { expression: NAVIGATOR_SPOOF_SCRIPT })
    .catch(() => {});

  let released = false;
  return {
    client,
    scriptId: identifier,
    async release() {
      if (released) return;
      released = true;
      try {
        await client.send("Fetch.disable");
        if (identifier) {
          await client.send("Page.removeScriptToEvaluateOnNewDocument", {
            identifier,
          });
        }
        await client.send("Network.setUserAgentOverride", { userAgent: "" });
      } catch {
        // Tab may already be gone; closing the connection is enough.
      }
      client.close();
    },
  };
}

module.exports = { attachSpoofedSession };
