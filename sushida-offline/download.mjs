// 寿司打のゲーム本体と、自動入力用の OCR エンジン(Tesseract.js)を site/ にダウンロードする。
// 個人利用専用。site/ はリポジトリに含めない(.gitignore 済み)。
// 使い方: node download.mjs
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "site");

const SUSHIDA = "https://sushida.net/";
const JSDELIVR = "https://cdn.jsdelivr.net/npm/";

// [保存先(site/ からの相対パス), 取得元 URL]
const FILES = [
  ...[
    "files/v1_3/UnityLoader.js",
    "files/v1_3/Web.json",
    "files/v1_3/Web.data.unityweb",
    "files/v1_3/Web.wasm.code.unityweb",
    "files/v1_3/Web.wasm.framework.unityweb",
    "TemplateData/UnityProgress.js",
    "TemplateData/style.css",
    "TemplateData/progressEmpty.Dark.png",
    "TemplateData/progressFull.Dark.png",
    "TemplateData/progressLogo.Dark.png",
  ].map((f) => [f, SUSHIDA + f]),
  ["vendor/tesseract.min.js", JSDELIVR + "tesseract.js@5.1.1/dist/tesseract.min.js"],
  ["vendor/worker.min.js", JSDELIVR + "tesseract.js@5.1.1/dist/worker.min.js"],
  ["vendor/core/tesseract-core-simd-lstm.wasm.js", JSDELIVR + "tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js"],
  ["vendor/core/tesseract-core-lstm.wasm.js", JSDELIVR + "tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js"],
  ["vendor/lang/eng.traineddata.gz", JSDELIVR + "@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz"],
];

async function exists(p) {
  try { return (await stat(p)).size > 0; } catch { return false; }
}

for (const [f, url] of FILES) {
  const dest = join(OUT, f);
  if (await exists(dest)) { console.log(`skip  ${f}`); continue; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`saved ${f} (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log("\n完了。次は `node serve.mjs` を実行してください。");
