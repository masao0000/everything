// ダウンロードした寿司打をローカルで配信する。外部への通信は CSP で遮断する。
// 使い方: node serve.mjs [port] [--open]  → http://localhost:8080/
//   --open を付けると、起動後にブラウザで開く
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SITE = join(ROOT, "site");
const args = process.argv.slice(2);
const OPEN = args.includes("--open");
const PORT = Number(args.find((a) => !a.startsWith("--")) || process.env.PORT || 8080);
const URL_ = `http://localhost:${PORT}/`;

function openBrowser() {
  const cmd = process.platform === "win32" ? `start "" "${URL_}"`
    : process.platform === "darwin" ? `open "${URL_}"` : `xdg-open "${URL_}"`;
  exec(cmd, () => {});
}

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

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // チートパネルの「終了」ボタン。独自ヘッダー必須にして、他のサイトからは止められないようにする。
  if (path === "/__quit" && req.method === "POST" && req.headers["x-sushida-quit"] === "1") {
    res.writeHead(204).end();
    console.log("終了ボタンが押されたので終了します。");
    server.close();
    setTimeout(() => process.exit(0), 200);
    return;
  }
  // ゲーム内エラーの記録 (原因調査用)。error-log.txt に追記する。
  if (path === "/__log" && req.method === "POST" && req.headers["x-sushida-log"] === "1") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { if (body.length < 65536) body += c; });
    req.on("end", async () => {
      await appendFile(join(ROOT, "error-log.txt"), body.slice(0, 65536) + "\n\n").catch(() => {});
      console.log("ゲーム内エラーを error-log.txt に記録しました。");
      res.writeHead(204).end();
    });
    return;
  }
  // ランキング送信 (cheat.js が sushida.net/php/r.php からここへ向け直す)。
  // 本物のサーバーも不正な送信には空の 200 を返すので、同じ応答にしてゲームを先に進ませる。
  if (path === "/php/r.php") {
    req.resume();
    res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" }).end();
    return;
  }
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
});
server
  .on("error", (e) => {
    if (e.code !== "EADDRINUSE") throw e;
    // すでに起動している場合はブラウザで開くだけ
    console.log(`すでに起動しています: ${URL_}`);
    if (OPEN) openBrowser();
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`寿司打オフライン: ${URL_}`);
    console.log("終了するときはチートパネルの「終了」を押すか、このウィンドウを閉じてください。");
    if (OPEN) openBrowser();
  });
