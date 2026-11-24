"use strict";

// Environment spoofing: the CDP equivalent of the extension's
// declarativeNetRequest rules + ua_spoof.js.
//
// Adapted from havenicec/google-qr-sms-helper (MIT). The two user
// agents and the header treatment are the same as the extension's:
//   - accounts.google.com generally presents as an iPad Mini, with all
//     Sec-CH-UA* client-hint headers removed (they would otherwise
//     reveal the real desktop platform).
//   - The /devicephoneverification/* sub-flow presents as an iPhone:
//     that is the "phone that scanned the QR code" side of the flow.

const IPAD_MINI_UA =
  "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const CLIENT_HINT_HEADERS = new Set([
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-model",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
]);

function uaForUrl(url) {
  return url.includes("accounts.google.com/devicephoneverification/")
    ? IPHONE_UA
    : IPAD_MINI_UA;
}

// rewriteHeaders(url, headers) -> [{name, value}, ...]
//
// `headers` is the plain object CDP's Fetch.requestPaused event
// provides. The result is the array Fetch.continueRequest expects:
// client hints dropped, User-Agent replaced (or added), everything
// else passed through untouched. Pure function; unit-tested.
function rewriteHeaders(url, headers) {
  const ua = uaForUrl(url);
  const out = [];
  let sawUA = false;
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (CLIENT_HINT_HEADERS.has(lower)) continue;
    if (lower === "user-agent") {
      out.push({ name, value: ua });
      sawUA = true;
      continue;
    }
    out.push({ name, value });
  }
  if (!sawUA) out.push({ name: "User-Agent", value: ua });
  return out;
}

// JS-side navigator spoof, injected with
// Page.addScriptToEvaluateOnNewDocument so it runs before page scripts
// on every navigation. Same properties as the extension's
// ua_spoof.js; window dimensions are deliberately not faked.
const NAVIGATOR_SPOOF_SCRIPT = `(() => {
  const IPAD_MINI_UA = ${JSON.stringify(IPAD_MINI_UA)};
  Object.defineProperty(navigator, 'userAgent', { get: () => IPAD_MINI_UA, configurable: true });
  Object.defineProperty(navigator, 'appVersion', { get: () => "5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1", configurable: true });
  Object.defineProperty(navigator, 'platform', { get: () => 'iPad', configurable: true });
  Object.defineProperty(navigator, 'vendor', { get: () => 'Apple Computer, Inc.', configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true });
  Object.defineProperty(navigator, 'userAgentData', { get: () => undefined, configurable: true });
})();`;

module.exports = {
  IPAD_MINI_UA,
  IPHONE_UA,
  CLIENT_HINT_HEADERS,
  uaForUrl,
  rewriteHeaders,
  NAVIGATOR_SPOOF_SCRIPT,
};
