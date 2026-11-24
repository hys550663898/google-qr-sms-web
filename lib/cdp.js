"use strict";

// Minimal Chrome DevTools Protocol (CDP) client.
//
// Zero dependencies: Node >= 22 ships a stable global WebSocket client,
// which is all CDP needs. Messages are JSON: commands carry an `id`,
// events carry a `method`.

class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.onClose = null;
    ws.addEventListener("message", (ev) => this._onMessage(ev));
    ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("CDP connection closed"));
      this.pending.clear();
      if (this.onClose) this.onClose();
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new CDPClient(ws);
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || "CDP error"));
      else p.resolve(msg.result || {});
      return;
    }
    const hs = this.handlers.get(msg.method);
    if (hs) {
      for (const h of hs) {
        try {
          h(msg.params || {});
        } catch {
          // Event handlers must never break the message loop.
        }
      }
    }
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }
}

async function cdpJson(port, path) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!r.ok) throw new Error(`CDP ${path} failed: HTTP ${r.status}`);
  return r.json();
}

function listTargets(port) {
  return cdpJson(port, "/json/list");
}

function cdpVersion(port) {
  return cdpJson(port, "/json/version");
}

module.exports = { CDPClient, listTargets, cdpVersion };
