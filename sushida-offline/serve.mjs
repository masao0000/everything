// ダウンロードした寿司打をローカルで配信する。外部への通信は CSP で遮断する。
// 使い方: node serve.mjs [port]  → http://localhost:8080/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SITE = join(ROOT, "site");
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

// ツール側のファイル（ランチャーとチート）。それ以外は site/ から返す。
const TOOL_FILES = { "/": "index.html", "/index.html": "index.html", "/cheat.js": "cheat.js" };

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".unityweb": "application/octet-stream",
};

// 'self' 以外への通信（ランキング送信など）を全部ブロックする
const CSP = [
  "default-src 'self' blob: data:",
  "script-src 'self' blob: 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' blob: data:",
].join("; ");

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = TOOL_FILES[path]
    ? join(ROOT, TOOL_FILES[path])
    : join(SITE, normalize(path).replace(/^([/\\]*\.\.)+/, ""));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Content-Security-Policy": CSP,
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found (先に node download.mjs を実行してください)");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`寿司打オフライン: http://localhost:${PORT}/`);
});
