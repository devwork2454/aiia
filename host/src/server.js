import http from "node:http";
import { pathToFileURL } from "node:url";
import { runAgent } from "./agent.js";

const PORT = Number(process.env.AIIA_HOST_PORT || 8787);

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        status: "ok",
        service: "aiia-host",
        mock: process.env.AIIA_MOCK === "1" || process.env.AIIA_MOCK === "true",
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/chat") {
      try {
        const payload = await readJson(req);
        const result = await runAgent(payload);
        return send(res, result.ok ? 200 : 502, result);
      } catch (e) {
        return send(res, 400, {
          ok: false,
          text: e instanceof Error ? e.message : String(e),
          session_key: "",
          mock: true,
        });
      }
    }

    return send(res, 404, { ok: false, text: "not found" });
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const server = createServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(
      `[aiia-host] listening on http://127.0.0.1:${PORT} mock=${process.env.AIIA_MOCK || "0"} pid=${process.pid}`,
    );
  });

  const shutdown = (signal) => {
    console.log(`[aiia-host] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    // Force-exit if connections linger
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
