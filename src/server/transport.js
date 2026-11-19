import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const base = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export async function startEphemeralServer(adapter, { root } = {}) {
  const token = randomBytes(32).toString("hex"),
    active = new Set();
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && origin !== "dsh-app://app" && origin !== "null") {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin || "dsh-app://app");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url, "http://localhost"),
      route = url.pathname;
    if (!route.startsWith("/" + token + "/")) {
      res.writeHead(403).end();
      return;
    }
    const name = route.slice(token.length + 2);
    try {
      if (req.method === "GET" && name === "visualization") {
        // Only self-contained HTML under the configured root. Resolve symlinks before checking.
        if (!root) {
          res.writeHead(403).end();
          return;
        }
        const allowed = await realpath(root),
          requested = url.searchParams.get("path");
        if (
          !requested ||
          !path.isAbsolute(requested) ||
          !/\.html?$/i.test(requested)
        ) {
          res.writeHead(400).end();
          return;
        }
        const file = await realpath(requested),
          relative = path.relative(allowed, file);
        if (
          relative === ".." ||
          relative.startsWith(".." + path.sep) ||
          path.isAbsolute(relative) ||
          !/\.html?$/i.test(file)
        ) {
          res.writeHead(403).end();
          return;
        }
        const info = await stat(file);
        if (!info.isFile() || info.size > 2_000_000) {
          res.writeHead(413).end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ html: await readFile(file, "utf8") }));
        return;
      }
      if (req.method === "GET" && name === "models") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(await adapter.listModels()));
        return;
      }
      if (
        req.method === "GET" &&
        (name === "katex.css" || name.startsWith("fonts/"))
      ) {
        if (!/^(katex\.css|fonts\/[\w.-]+)$/.test(name)) {
          res.writeHead(404).end();
          return;
        }
        res.setHeader(
          "Content-Type",
          name.endsWith(".css") ? "text/css" : "font/woff2",
        );
        res.end(
          await readFile(path.join(base, "node_modules/katex/dist", name)),
        );
        return;
      }
      if (req.method !== "POST" || name !== "chat") {
        res.writeHead(404).end();
        return;
      }
      let raw = "";
      for await (const c of req) {
        raw += c;
        if (raw.length > 2_000_000) {
          res.writeHead(413).end();
          return;
        }
      }
      const body = JSON.parse(raw);
      if (!Array.isArray(body.messages) || typeof body.route !== "string")
        throw Error("无效请求");
      const controller = new AbortController();
      active.add(controller);
      res.on("close", () => controller.abort());
      res.setHeader("Content-Type", "application/x-ndjson");
      res.flushHeaders();
      try {
        for await (const e of adapter.stream({
          route: body.route,
          messages: body.messages,
          signal: controller.signal,
        })) {
          if (!res.destroyed) res.write(JSON.stringify(e) + "\n");
        }
      } catch (e) {
        if (!res.destroyed)
          res.write(JSON.stringify({ error: e.message }) + "\n");
      } finally {
        active.delete(controller);
        res.end();
      }
    } catch (e) {
      if (!res.headersSent) res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/${token}/`,
    close() {
      for (const c of active) c.abort();
      server.close();
      server.closeAllConnections();
    },
  };
}
