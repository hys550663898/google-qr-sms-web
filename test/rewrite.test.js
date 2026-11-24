"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { rewriteHeaders, IPAD_MINI_UA, IPHONE_UA } = require("../lib/spoof");

function toObj(arr) {
  const o = {};
  for (const { name, value } of arr) o[name.toLowerCase()] = value;
  return o;
}

const baseHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
  "Sec-CH-UA": '"Chromium";v="130"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  Accept: "text/html",
  Cookie: "SID=secret",
};

test("devicephoneverification paths present as iPhone, hints removed", () => {
  const out = toObj(
    rewriteHeaders(
      "https://accounts.google.com/devicephoneverification/begin?dsh=1",
      baseHeaders,
    ),
  );
  assert.equal(out["user-agent"], IPHONE_UA);
  assert.equal(out["sec-ch-ua"], undefined);
  assert.equal(out["sec-ch-ua-mobile"], undefined);
  assert.equal(out["sec-ch-ua-platform"], undefined);
  assert.equal(out["accept"], "text/html");
  assert.equal(out["cookie"], "SID=secret");
});

test("other accounts.google.com paths present as iPad Mini", () => {
  const out = toObj(
    rewriteHeaders(
      "https://accounts.google.com/v3/signin/challenge/iap/qrcode",
      baseHeaders,
    ),
  );
  assert.equal(out["user-agent"], IPAD_MINI_UA);
  assert.equal(out["sec-ch-ua"], undefined);
});

test("batchexecute code submission also presents as iPad Mini", () => {
  const out = toObj(
    rewriteHeaders(
      "https://accounts.google.com/_/IdvUplevelingUi/data/batchexecute?rpcids=x",
      baseHeaders,
    ),
  );
  assert.equal(out["user-agent"], IPAD_MINI_UA);
});

test("missing User-Agent is added, empty headers tolerated", () => {
  const out = toObj(rewriteHeaders("https://accounts.google.com/", { Accept: "*/*" }));
  assert.equal(out["user-agent"], IPAD_MINI_UA);
  assert.equal(out["accept"], "*/*");
  assert.ok(Array.isArray(rewriteHeaders("https://accounts.google.com/", undefined)));
});
