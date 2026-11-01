"use strict";
/*
  Balderdash Night server.
  - Serves public/index.html.
  - /ws is a tiny "presence relay": every phone sends its own small state object,
    and the server forwards everyone's state to everyone else. The game rules run
    in the browsers; the server never looks inside the state except to size-check it.
  - Nothing is saved to disk. Restarting the server ends every game in progress.
*/
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const GRACE_MS = Number(process.env.GRACE_MS) || 25000; // keep a dropped phone's state this long
const MAX_CLIENTS = 400;
const MAX_PRESENCE_BYTES = 8192;
const PUB = path.join(__dirname, "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch (e) {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(PUB, pathname));
  if (!file.startsWith(PUB + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 40000 });
/** tabId -> { presence, updatedAt, ws, goneAt } */
const clients = new Map();
let timer = null;

const label = (id) => crypto.createHash("sha1").update(id).digest("hex").slice(0, 12);

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    broadcast();
  }, 60);
}

function broadcast() {
  const live = [];
  clients.forEach((c, id) => {
    if (c.presence && c.presence.rc) {
      live.push({ peer: label(id), presence: c.presence, updatedAt: c.updatedAt });
    }
  });
  clients.forEach((c, id) => {
    if (!c.ws || c.ws.readyState !== 1) return;
    const me = label(id);
    const peers = live.filter((p) => p.peer !== me);
    c.ws.send(JSON.stringify({ t: "peers", peers }));
  });
}

wss.on("connection", (ws) => {
  let id = null;
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!m || typeof m !== "object") return;

    if (m.t === "hello") {
      if (id || typeof m.cid !== "string" || !/^[A-Za-z0-9_.:@+-]{8,64}$/.test(m.cid)) return;
      if (!clients.has(m.cid) && clients.size >= MAX_CLIENTS) {
        ws.close(1013);
        return;
      }
      id = m.cid;
      let c = clients.get(id);
      if (!c) {
        c = { presence: {}, updatedAt: Date.now(), ws: null, goneAt: 0 };
        clients.set(id, c);
      }
      if (c.ws && c.ws !== ws) {
        try {
          c.ws.close(4000);
        } catch (e) {}
      }
      c.ws = ws;
      c.goneAt = 0;
      schedule();
    } else if (m.t === "set" && id) {
      const p = m.presence;
      if (!p || typeof p !== "object" || Array.isArray(p)) return;
      let s;
      try {
        s = JSON.stringify(p);
      } catch (e) {
        return;
      }
      if (s.length > MAX_PRESENCE_BYTES) return;
      const c = clients.get(id);
      if (!c) return;
      c.presence = p;
      c.updatedAt = Date.now();
      schedule();
    }
  });

  ws.on("close", () => {
    const c = id && clients.get(id);
    if (c && c.ws === ws) {
      c.ws = null;
      c.goneAt = Date.now();
      schedule();
    }
  });
  ws.on("error", () => {});
});

// Forget phones that stayed away longer than the grace period.
setInterval(() => {
  const now = Date.now();
  let removed = false;
  clients.forEach((c, id) => {
    if (!c.ws && (!c.goneAt || now - c.goneAt > GRACE_MS)) {
      clients.delete(id);
      removed = true;
    }
  });
  if (removed) schedule();
}, 2000).unref();

// Heartbeat: keeps connections open through hosting proxies and clears dead ones.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {}
  });
}, 25000).unref();

server.listen(PORT, () => {
  console.log("Balderdash Night is running on port " + PORT);
});

module.exports = server;
