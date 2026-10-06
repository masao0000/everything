// 寿司打オフライン用チート。UnityLoader より先に読み込むこと。
//  - ドメインチェック回避 (document.URL を sushida.net に偽装)
//  - 時間操作 (ゲーム内時間の速さを変える / 止める)
//  - 自動入力 (ローマ字欄を OCR で読んでキー入力を送る)
(() => {
  "use strict";

  // ---- ドメインチェック回避: Unity は document.URL で sushida.net か判定している ----
  Object.defineProperty(document, "URL", { get: () => "https://sushida.net/play.html" });

  // ---- 画面読み取り用: WebGL の描画バッファを保持させる ----
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return realGetContext.call(this, type, attrs);
  };

  // ---- 時間操作: performance.now / Date.now を倍率つきの仮想時計に差し替える ----
  const realPerf = performance.now.bind(performance);
  const realDate = Date.now;
  let scale = 1;
  let lastReal = realPerf();
  let virt = lastReal;
  const dateOffset = realDate() - lastReal;

  function tick() {
    const r = realPerf();
    virt += (r - lastReal) * scale;
    lastReal = r;
    return virt;
  }
  performance.now = tick;
  Date.now = () => Math.floor(tick() + dateOffset);
  const realRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => realRaf(() => cb(tick()));

  function setSpeed(v) { tick(); scale = Math.max(0, Number(v) || 0); }

  // ---- 自動入力 ----
  // 画面座標はゲーム本来の 500x420 基準。ローマ字は暗い吹き出しの中に白文字で出る。
  const BOX_PROBE_Y = 258;            // 吹き出し内でローマ字より下の、文字がない行
  const ROMAJI_TOP = 230, ROMAJI_BOTTOM = 255;
  const UPSCALE = 3;
  const WHITELIST = "abcdefghijklmnopqrstuvwxyz-,.!?0123456789";

  const auto = { on: false, delay: 15, busy: false, worker: null, loading: null, typed: 0, last: "" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function loadScript(src) {
    return new Promise((ok, ng) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => ng(new Error(src + " を読み込めません"));
      document.head.appendChild(s);
    });
  }

  async function getWorker() {
    if (auto.worker) return auto.worker;
    auto.loading ??= (async () => {
      await loadScript("vendor/tesseract.min.js");
      const w = await Tesseract.createWorker("eng", 1, {
        workerPath: "vendor/worker.min.js",
        corePath: "vendor/core",
        langPath: "vendor/lang",
        workerBlobURL: false,
      });
      await w.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: WHITELIST });
      auto.worker = w;
      return w;
    })();
    return auto.loading;
  }

  // 吹き出しは半透明の暗色なので、後ろに皿が重なると灰色になる。暗ければ吹き出しとみなす。
  const isBoxColor = (r, g, b) => Math.max(r, g, b) < 90;

  // ローマ字欄を切り出し、文字を黒・背景を白にした画像にする。
  // 入力済みの文字はグレー、未入力の文字は白で表示されるので、OCR は単語全体に対して行い
  // (文字が多いほうが精度が上がる)、白い文字が始まる位置 restX より右を未入力として扱う。
  // 吹き出しが無い・全部打ち終わっている場合は null。
  function captureRomaji() {
    const game = document.querySelector("#gameContainer canvas");
    if (!game || !game.width) return null;
    const sx = game.width / 500, sy = game.height / 420;
    const work = captureRomaji.work ||= document.createElement("canvas");
    const wctx = work.getContext("2d", { willReadFrequently: true });
    work.width = game.width; work.height = game.height;
    wctx.drawImage(game, 0, 0);

    // 吹き出しの左右端を探す
    const py = Math.round(BOX_PROBE_Y * sy);
    const row = wctx.getImageData(0, py, game.width, 1).data;
    const cx = Math.round(250 * sx);
    const at = (x) => isBoxColor(row[x * 4], row[x * 4 + 1], row[x * 4 + 2]);
    if (!at(cx)) return null; // プレイ画面ではない
    let l = cx, r = cx;
    while (l > 0 && at(l - 1)) l--;
    while (r < game.width - 1 && at(r + 1)) r++;
    l += Math.round(3 * sx); r -= Math.round(3 * sx);
    if (r - l < 20 * sx) return null;

    const y0 = Math.round(ROMAJI_TOP * sy), h = Math.round((ROMAJI_BOTTOM - ROMAJI_TOP) * sy), w = r - l;
    const src = wctx.getImageData(l, y0, w, h);
    const d = src.data;
    let restX = Infinity;
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.min(d[i], d[i + 1], d[i + 2]);
      if (lum > 175) restX = Math.min(restX, (i / 4) % w);
      const v = lum > 85 ? 0 : 255; // 白もグレーも文字として扱う
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    if (restX === Infinity) return null; // 全部打ち終わっている

    const tmp = captureRomaji.tmp ||= document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    tmp.getContext("2d").putImageData(src, 0, 0);
    const img = document.createElement("canvas");
    const pad = 12, k = UPSCALE / Math.max(sx, sy);
    img.width = Math.round(w * k) + pad * 2; img.height = Math.round(h * k) + pad * 2;
    const ictx = img.getContext("2d");
    ictx.fillStyle = "#fff"; ictx.fillRect(0, 0, img.width, img.height);
    ictx.drawImage(tmp, pad, pad, img.width - pad * 2, img.height - pad * 2);
    return { img, restX: pad + restX * k };
  }

  const ALLOWED = /[^a-z0-9\-,.!?]/g; // WHITELIST 以外の文字

  // OCR 結果から、x 座標が restX 以降にある文字(=未入力)だけをつなげて返す
  function remainingText(data, restX) {
    let all = "", rest = "";
    for (const b of data.blocks || []) for (const p of b.paragraphs) for (const ln of p.lines)
      for (const wd of ln.words) for (const sym of wd.symbols) {
        const t = sym.text.toLowerCase().replace(ALLOWED, "");
        all += t;
        if ((sym.bbox.x0 + sym.bbox.x1) / 2 >= restX - 2) rest += t;
      }
    return { all, rest };
  }

  function sendKey(ch) {
    const code = ch.charCodeAt(0);
    document.dispatchEvent(new KeyboardEvent("keypress", { key: ch, charCode: code, keyCode: code, which: code, bubbles: true }));
  }

  async function autoLoop() {
    if (auto.busy) return;
    auto.busy = true;
    try {
      const worker = await getWorker();
      ui.status("自動入力中");
      while (auto.on) {
        const cap = captureRomaji();
        if (!cap) { await sleep(40); continue; }
        const { data } = await worker.recognize(cap.img, {}, { text: true, blocks: true });
        const { all, rest: text } = remainingText(data, cap.restX);
        if (auto.debug) console.log("[auto] ocr", all, "->", text);
        if (!text || !auto.on) { await sleep(40); continue; }
        auto.last = all;
        for (const ch of text) {
          if (!auto.on) break;
          sendKey(ch);
          auto.typed++;
          if (auto.delay) await sleep(auto.delay);
        }
        ui.update();
        await sleep(30); // 画面の更新を待つ
      }
    } catch (e) {
      console.error(e);
      auto.on = false;
      ui.status("エラー: " + e.message);
    } finally {
      auto.busy = false;
      ui.update();
    }
  }

  function setAuto(on) {
    auto.on = on;
    if (on) { ui.status("OCR を準備中…"); autoLoop(); }
    else ui.status("停止中");
    ui.update();
  }

  // ---- 操作パネル ----
  const ui = { status() {}, update() {} };

  function buildPanel() {
    const root = document.getElementById("cheat-panel");
    if (!root) return;
    root.innerHTML = `
      <style>
        #cheat-panel { width: 260px; background: #2a2420; color: #f3e9dc; border: 2px solid #8a5a2b; border-radius: 10px; padding: 14px 16px; font-size: 14px; display: grid; gap: 14px; }
        #cheat-panel h2 { margin: 0; font-size: 16px; letter-spacing: .05em; }
        #cheat-panel section { display: grid; gap: 8px; }
        #cheat-panel .label { font-size: 12px; color: #c9b49a; letter-spacing: .04em; }
        #cheat-panel .row { display: flex; gap: 6px; flex-wrap: wrap; }
        #cheat-panel button { font: inherit; background: #4a3b30; color: #f3e9dc; border: 1px solid #8a5a2b; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
        #cheat-panel button[aria-pressed="true"] { background: #c0392b; border-color: #e5735f; color: #fff; }
        #cheat-panel button:focus-visible { outline: 2px solid #f5c26b; outline-offset: 2px; }
        #cheat-panel input[type=range] { width: 100%; }
        #cheat-panel .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
        #cheat-panel .note { font-size: 12px; color: #a8957f; line-height: 1.5; margin: 0; }
      </style>
      <h2>チートパネル</h2>
      <section>
        <span class="label">自動入力</span>
        <div class="row"><button id="ch-auto" type="button" aria-pressed="false">OFF</button></div>
        <label class="label" for="ch-delay">1文字あたりの間隔 <span id="ch-delay-v" class="mono"></span></label>
        <input id="ch-delay" type="range" min="0" max="200" step="5">
        <div class="mono" id="ch-status">停止中</div>
        <div class="mono" id="ch-last"></div>
      </section>
      <section>
        <span class="label">時間の速さ</span>
        <div class="row" id="ch-speed">
          <button type="button" data-v="0">停止</button>
          <button type="button" data-v="0.25">×0.25</button>
          <button type="button" data-v="0.5">×0.5</button>
          <button type="button" data-v="1">×1</button>
          <button type="button" data-v="2">×2</button>
        </div>
      </section>
      <p class="note">ゲーム画面を一度クリックしてからスペースで開始。ローマ字表示は「設定」でONのままにしてください。ランキング送信は遮断しています。</p>`;

    const $ = (id) => document.getElementById(id);
    const autoBtn = $("ch-auto"), delay = $("ch-delay");
    delay.value = auto.delay;
    autoBtn.onclick = () => setAuto(!auto.on);
    delay.oninput = () => { auto.delay = Number(delay.value); ui.update(); };
    $("ch-speed").onclick = (e) => {
      const v = e.target.closest("button")?.dataset.v;
      if (v != null) { setSpeed(v); ui.update(); }
    };
    ui.status = (s) => { $("ch-status").textContent = s; };
    ui.update = () => {
      autoBtn.textContent = auto.on ? "ON" : "OFF";
      autoBtn.setAttribute("aria-pressed", String(auto.on));
      $("ch-delay-v").textContent = `${auto.delay} ms`;
      $("ch-last").textContent = auto.last ? `読み取り: ${auto.last}` : "";
      for (const b of $("ch-speed").children) b.setAttribute("aria-pressed", String(Number(b.dataset.v) === scale));
    };
    ui.update();
  }

  document.addEventListener("DOMContentLoaded", buildPanel);

  window.sushiCheat = {
    get speed() { return scale; },
    set speed(v) { setSpeed(v); ui.update(); },
    get auto() { return auto.on; },
    set auto(v) { setAuto(!!v); },
    set delay(v) { auto.delay = Number(v) || 0; ui.update(); },
    set debug(v) { auto.debug = !!v; },
    captureRomaji,
  };
})();
