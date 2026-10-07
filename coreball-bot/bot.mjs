#!/usr/bin/env node
// まち針ゲーム (https://www.arealme.com/coreball/ja/) を自動で進めるスクリプト。
// 使い方: node bot.mjs [--levels 10] [--headless] [--retries 3] [--margin 3] [--profile ./profile]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({
  allowNegative: true, // --no-block-ads を使えるように
  options: {
    url: { type: "string", default: "https://www.arealme.com/coreball/ja/" },
    levels: { type: "string", default: "10" }, // 何レベル進めるか
    retries: { type: "string", default: "3" }, // 同じレベルで失敗してよい回数
    margin: { type: "string", default: "1" }, // 安全マージン (度)。大きいほど慎重だが密集レベルで詰まりやすい
    profile: { type: "string", default: join(here, "profile") }, // 進行状況の保存先
    headless: { type: "boolean", default: false },
    "block-ads": { type: "boolean", default: true },
  },
});

const levels = Number(opt.levels);
const retries = Number(opt.retries);
const injectSrc = readFileSync(join(here, "inject.js"), "utf8");

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const launchOpts = {
  headless: opt.headless,
  viewport: { width: 900, height: 760 },
  ...(proxy ? { proxy: { server: proxy } } : {}),
};
// Playwright 用ブラウザが無ければ、PC に入っている Edge / Chrome を使う
let context;
for (const channel of [undefined, "msedge", "chrome"]) {
  try {
    context = await chromium.launchPersistentContext(resolve(opt.profile), { ...launchOpts, ...(channel ? { channel } : {}) });
    break;
  } catch (e) {
    if (channel === "chrome") {
      console.error("ブラウザを起動できませんでした。Microsoft Edge か Google Chrome をインストールしてください。");
      throw e;
    }
  }
}
await context.addInitScript(injectSrc);

if (opt["block-ads"]) {
  const adHosts = /(doubleclick|googlesyndication|googleadservices|adservice\.google|google-analytics|googletagmanager|fundingchoices|adnxs|amazon-adsystem|criteo|taboola|outbrain)\./;
  await context.route("**/*", (route) =>
    adHosts.test(new URL(route.request().url()).hostname) ? route.abort() : route.continue(),
  );
}

const page = context.pages()[0] || (await context.newPage());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(opt.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("#coreball_playbutton", { timeout: 60_000 });
await page.waitForFunction(() => window.coreBall && window._coreballInstance);
await page.evaluate(([m, d]) => Object.assign(window.__cbBot, { exactMargin: m, debug: d }), [Number(opt.margin), !!process.env.CB_DEBUG]);

const currentLevel = () => page.evaluate(() => Number(document.getElementById("coreball_level")?.textContent) || null);

// スキン獲得などのポップアップを閉じる (マスク部分のクリック = ゲーム自身の閉じる動作)
async function closePanels() {
  await page.evaluate(() =>
    document.querySelectorAll(".panel-mask").forEach((m) => {
      if (m.style.display !== "none" && m.dataset.disableClose !== "1") m.click();
    }),
  );
}

async function playOnce() {
  await closePanels();
  const before = await page.evaluate(() => {
    window.__cbBot.reset();
    window.__cbBot.enabled = true;
    return window.__cbBot.results.length;
  });
  // 自動 OFF の間は次のレベルを始めない (ON に戻すまで待つ)
  if (!(await page.evaluate(() => window.__cbBot.auto))) {
    console.log("⏸  自動 OFF 中… 画面右上のボタンか「A」キーで ON に戻すと再開します");
    await page.waitForFunction(() => window.__cbBot.auto, null, { timeout: 0, polling: 200 });
    console.log("▶  再開");
  }
  await page.click("#coreball_playbutton", { timeout: 15_000 });
  // 結果 (pass/fail) が出るまで待つ。1 レベル最大 3 分
  await page.waitForFunction((n) => window.__cbBot.results.length > n, before, { timeout: 0, polling: 100 });
  const res = await page.evaluate(() => window.__cbBot.results.at(-1));
  // ステージが閉じてプレイボタンに戻るまで待つ
  await page.waitForFunction(() => document.getElementById("coreball_stage")?.style.display === "none", null, {
    timeout: 15_000,
  });
  await page.evaluate(() => (window.__cbBot.enabled = false));
  await sleep(400);
  return res;
}

let cleared = 0;
let fails = 0;
console.log(`開始レベル: ${await currentLevel()}  目標: ${levels} レベル`);
while (cleared < levels) {
  const t0 = Date.now();
  let res;
  try {
    res = await playOnce();
  } catch (e) {
    console.error("プレイ中にエラー:", e.message);
    break;
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.result === "pass") {
    cleared++;
    fails = 0;
    console.log(`✅ レベル ${res.level} クリア (${res.shots} 発, ${sec}s, 予測: ${res.model})`);
  } else {
    fails++;
    console.log(`❌ レベル ${res.level} 失敗 (${res.shots} 発目, 予測: ${res.model}) [${fails}/${retries}]`);
    if (process.env.CB_DEBUG) console.log(JSON.stringify(await page.evaluate(() => [window.__cbBot.results.at(-1), window.__cbBot.log.slice(-4)])));
    if (fails >= retries) {
      console.log("連続失敗の上限に達したので終了します。--margin を上げると慎重になります。");
      break;
    }
  }
}
console.log(`終了: ${cleared} レベルクリア / 現在のレベル ${await currentLevel()}`);
await context.close();
