// 寿司打オフライン用チート。UnityLoader より先に読み込むこと。
//  - ドメインチェック回避 (document.URL を sushida.net に偽装)
//  - 時間操作 (ゲーム内時間の速さを変える / 止める)
//  - 自動入力 (ローマ字欄を OCR で読んでキー入力を送る)
(() => {
  "use strict";

  // ---- ドメインチェック回避: Unity は document.URL で sushida.net か判定している ----
  Object.defineProperty(document, "URL", { get: () => "https://sushida.net/play.html" });

  // ---- ランキング送信の差し替え ----
  // 送信を遮断して通信エラーにすると、ゲーム内部で例外が起きて止まることがある。
  // sushida.net 宛ての通信はローカルサーバー(serve.mjs)に向け、空の応答を返させる。
  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === "string") url = url.replace(/^https?:\/\/(www\.)?sushida\.net\//, "/");
    return realOpen.call(this, method, url, ...rest);
  };

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
  // lastGameRaf: ゲームが最後に次のフレームを予約した時刻(メインループが止まっていないかの判定用)
  let lastGameRaf = realPerf();
  window.requestAnimationFrame = (cb) => { lastGameRaf = realPerf(); return realRaf(() => cb(tick())); };

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
    let restX = Infinity, white = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.min(d[i], d[i + 1], d[i + 2]);
      if (lum > 175) { restX = Math.min(restX, (i / 4) % w); white++; }
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
    // restX: 未入力部分の開始位置(OCR 画像上) / white: 未入力の白い画素数 / l, r: 吹き出しの左右端
    return { img, restX: pad + restX * k, white, l, r };
  }

  // before を撮ったあと画面が進んだか。1文字打つと白い文字がグレーに変わり、次の単語に
  // 変わっても白い画素数が変わるので、白い画素数か吹き出しの幅が変われば進んだとみなす。
  function progressed(before, after) {
    if (!after) return true;
    if (Math.abs(after.l - before.l) > 2 || Math.abs(after.r - before.r) > 2) return true;
    return Math.abs(after.white - before.white) > 3;
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

  const nextFrame = () => new Promise((r) => realRaf(() => r()));

  // 画面が進むまで最大 maxFrames フレーム待つ。進んだら true。
  async function waitProgress(before, maxFrames) {
    for (let i = 0; i < maxFrames; i++) {
      await nextFrame();
      if (progressed(before, captureRomaji())) return true;
    }
    return false;
  }

  // OCR が同じ文字を読み間違え続けると先に進めないので、1文字ずつ試して進んだら止める。
  // 間違ったキーはミス扱いになるだけで、ゲームは正しいキーが来るまで待ってくれる。
  const FALLBACK_ORDER = "aiueonkstrhmyzgdbpwjcfvlqx-,.!?0123456789";
  async function bruteForce(cap, guess) {
    for (const ch of new Set(guess + FALLBACK_ORDER)) {
      if (!auto.on) return false;
      sendKey(ch);
      auto.typed++;
      if (await waitProgress(cap, 6)) return true;
    }
    return false;
  }

  async function autoStep(worker) {
    const cap = captureRomaji();
    if (!cap) { await sleep(40); return; }
    const { data } = await worker.recognize(cap.img, {}, { text: true, blocks: true });
    const { all, rest: text } = remainingText(data, cap.restX);
    if (auto.debug) console.log("[auto] ocr", all, "->", text);
    if (!auto.on) return;
    auto.last = all;
    for (const ch of text) {
      if (!auto.on) return;
      sendKey(ch);
      auto.typed++;
      if (auto.delay) await sleep(auto.delay);
    }
    ui.update();

    // 打ったのに画面が進まない = 先頭の文字を読み間違えている
    if (!(await waitProgress(cap, 10))) {
      const after = captureRomaji();
      if (!after) return;
      if (auto.debug) console.log("[auto] stuck, brute force from", JSON.stringify(text));
      ui.status("読み間違い → 1文字ずつ試行中");
      await bruteForce(after, text.slice(0, 1));
      ui.status("自動入力中");
    }
  }

  async function autoLoop() {
    if (auto.busy) return;
    auto.busy = true;
    try {
      const worker = await getWorker();
      ui.status("自動入力中");
      while (auto.on) {
        try {
          await autoStep(worker);
        } catch (e) {
          // 1回の失敗で止めずに続ける
          console.error(e);
          ui.status("エラー(続行中): " + e.message);
          await sleep(300);
        }
      }
    } catch (e) {
      console.error(e);
      auto.on = false;
      ui.status("OCR を起動できません: " + e.message);
    } finally {
      auto.busy = false;
      ui.update();
    }
  }

  // ---- 皿数の上限 ----
  // このゲームは 600 皿に届くとフリーズする(内部エラーになる)ので、手前で自動入力を止める。
  // 皿数は画面左の看板「○○皿」の数字を OCR で読み取る。
  const SIGN = { l: 14, r: 98, t: 227, b: 275 }; // 看板の白い部分(500x420 基準)
  const plates = { count: 0, limit: 580, worker: null, loading: null };
  const LIMIT_MESSAGE = "システム上限(600皿)に到達しそうなので自動入力をストップしました";

  async function getDigitWorker() {
    if (plates.worker) return plates.worker;
    plates.loading ??= (async () => {
      await getWorker(); // Tesseract 本体の読み込みを共有
      const w = await Tesseract.createWorker("eng", 1, {
        workerPath: "vendor/worker.min.js", corePath: "vendor/core", langPath: "vendor/lang", workerBlobURL: false,
      });
      await w.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789" });
      plates.worker = w;
      return w;
    })();
    return plates.loading;
  }

  // 看板の数字部分(最後の「皿」の字を除く)を白黒の画像にして返す。看板が無ければ null。
  function captureSign() {
    const game = document.querySelector("#gameContainer canvas");
    if (!game || !game.width) return null;
    const sx = game.width / 500, sy = game.height / 420;
    const work = captureSign.work ||= document.createElement("canvas");
    const wctx = work.getContext("2d", { willReadFrequently: true });
    work.width = game.width; work.height = game.height;
    wctx.drawImage(game, 0, 0);
    const X = (v) => Math.round(v * sx), Y = (v) => Math.round(v * sy);
    const x0 = X(SIGN.l + 2), y0 = Y(SIGN.t + 3), w = X(SIGN.r - 2) - x0, h = Y(SIGN.b - 3) - y0;
    const img = wctx.getImageData(x0, y0, w, h), d = img.data;
    // 看板の四隅付近が白くなければ看板は出ていない
    const px = (x, y) => { const i = (y * w + x) * 4; return Math.min(d[i], d[i + 1], d[i + 2]); };
    if ([px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)].some((v) => v < 225)) return null;
    // 黒い文字の列を左右に区切る。最後のかたまりが「皿」
    const dark = (x) => { for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 300) return true; } return false; };
    const segs = [];
    for (let x = 0, start = -1; x <= w; x++) {
      const on = x < w && dark(x);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { segs.push([start, x - 1]); start = -1; }
    }
    if (segs.length < 2) return null;
    const a = Math.max(0, segs[0][0] - 3), b = Math.min(w, segs[segs.length - 2][1] + 4);
    const tmp = document.createElement("canvas");
    tmp.width = b - a; tmp.height = h;
    const tctx = tmp.getContext("2d");
    tctx.putImageData(wctx.getImageData(x0 + a, y0, b - a, h), 0, 0);
    const out = document.createElement("canvas");
    const k = UPSCALE / Math.max(sx, sy), pad = 12;
    out.width = Math.round((b - a) * k) + pad * 2; out.height = Math.round(h * k) + pad * 2;
    const octx = out.getContext("2d");
    octx.fillStyle = "#fff"; octx.fillRect(0, 0, out.width, out.height);
    octx.filter = "grayscale(1) contrast(3)";
    octx.drawImage(tmp, pad, pad, out.width - pad * 2, out.height - pad * 2);
    return out;
  }

  let lastRead = -1;
  async function plateWatch() {
    for (;;) {
      await sleep(700);
      if (ending || document.hidden) continue;
      const img = captureSign();
      if (!img) { if (!captureRomaji()) { plates.count = 0; lastRead = -1; } continue; }
      // 自動入力中か、ある程度皿が積み上がってから読み始める(OCR の負荷を抑える)
      if (!auto.on && plates.count === 0 && lastRead < 0 && !plates.worker) continue;
      try {
        const w = await getDigitWorker();
        const { data } = await w.recognize(img);
        const n = parseInt(data.text.replace(/\D/g, ""), 10);
        if (!Number.isFinite(n)) continue;
        // 読み間違い対策: 2回続けて同じくらいの値なら採用
        if (lastRead >= 0 && Math.abs(n - lastRead) <= 15) {
          plates.count = n;
          ui.update();
          if (n >= plates.limit && auto.on) {
            auto.on = false;
            ui.status(LIMIT_MESSAGE);
            ui.update();
          }
        }
        lastRead = n;
      } catch (e) { console.error(e); }
    }
  }

  // ---- コース終了 ----
  // ゲーム内時間を一気に早送りして残り時間を 0 にし、通常どおり結果画面まで進める。
  // (Unity は1フレームで進める時間に上限があるので、終わるまで数秒かかる)
  const END_SPEED = 60;
  let ending = false;
  async function endCourse(doneMessage) {
    if (ending) return;
    if (!captureRomaji()) { ui.status("プレイ中のコースがありません"); return; }
    ending = true;
    const prevSpeed = scale, prevAuto = auto.on;
    auto.on = false;
    setSpeed(END_SPEED);
    ui.status("コースを終了中…");
    ui.update();
    const start = realPerf();
    let lastBox = start;
    // 吹き出しが 1.5 秒出てこなくなったら結果画面に移ったとみなす(最大 30 秒)
    while (realPerf() - start < 30000 && realPerf() - lastBox < 1500) {
      await nextFrame();
      if (captureRomaji()) lastBox = realPerf();
    }
    setSpeed(prevSpeed);
    ending = false;
    plates.count = 0; lastRead = -1;
    ui.status(doneMessage || (prevAuto ? "コースを終了しました(自動入力はOFFにしました)" : "コースを終了しました"));
    ui.update();
  }

  function setAuto(on) {
    if (on && plates.count >= plates.limit) { ui.status(LIMIT_MESSAGE); ui.update(); return; }
    auto.on = on;
    if (on) { ui.status("OCR を準備中…"); autoLoop(); }
    else ui.status("停止中");
    ui.update();
  }

  // ---- 操作パネル ----
  const ui = { status() {}, update() {}, gameError() {} };

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
        #cheat-panel button.wide { width: 100%; }
        #cheat-panel button.quit { width: 100%; background: #3a2d26; }
        #cheat-panel button.quit.armed { background: #c0392b; border-color: #e5735f; color: #fff; }
        #cheat-panel .note { font-size: 12px; color: #a8957f; line-height: 1.5; margin: 0; }
      </style>
      <h2>チートパネル</h2>
      <section>
        <span class="label">自動入力</span>
        <div class="row"><button id="ch-auto" type="button" aria-pressed="false">OFF</button></div>
        <label class="label" for="ch-delay">1文字あたりの間隔 <span id="ch-delay-v" class="mono"></span></label>
        <input id="ch-delay" type="range" min="0" max="200" step="5">
        <div class="mono" id="ch-status">停止中</div>
        <div id="ch-error" hidden>
          <p class="note" id="ch-error-msg"></p>
          <div class="row"><button id="ch-reload" type="button">ゲームを再起動</button></div>
        </div>
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
      <section>
        <span class="label">コース</span>
        <div class="mono" id="ch-plates"></div>
        <div class="row"><button id="ch-end" type="button" class="wide">このコースを終了</button></div>
      </section>
      <p class="note">ゲーム画面を一度クリックしてからスペースで開始。ローマ字表示は「設定」でONのままにしてください。ランキング送信は遮断しています。</p>
      <div class="row"><button id="ch-quit" type="button" class="quit">アプリを閉じる</button></div>`;

    const $ = (id) => document.getElementById(id);
    const autoBtn = $("ch-auto"), delay = $("ch-delay");
    delay.value = auto.delay;
    autoBtn.onclick = () => setAuto(!auto.on);
    delay.oninput = () => { auto.delay = Number(delay.value); ui.update(); };
    $("ch-speed").onclick = (e) => {
      const v = e.target.closest("button")?.dataset.v;
      if (v != null) { setSpeed(v); ui.update(); }
    };
    $("ch-reload").onclick = () => location.reload();
    $("ch-end").onclick = () => endCourse();
    plateWatch();
    // 誤って押してもすぐ終わらないよう、3秒以内にもう一度押したら終了する
    const quitBtn = $("ch-quit");
    let quitTimer = 0;
    quitBtn.onclick = () => {
      if (!quitBtn.classList.contains("armed")) {
        quitBtn.classList.add("armed");
        quitBtn.textContent = "もう一度押すと閉じます";
        quitTimer = setTimeout(() => { quitBtn.classList.remove("armed"); quitBtn.textContent = "アプリを閉じる"; }, 3000);
        return;
      }
      clearTimeout(quitTimer);
      quit();
    };
    ui.status = (s) => { $("ch-status").textContent = s; };
    ui.gameError = (err, alive) => {
      $("ch-error-msg").textContent = alive
        ? `ゲーム内エラーを ${err.count} 回検出し、自動で復帰しました。動きがおかしいときは再起動してください。`
        : "ゲーム内エラーで止まり、自動で復帰できませんでした。再起動してください。";
      $("ch-error").hidden = false;
    };
    ui.update = () => {
      autoBtn.textContent = auto.on ? "ON" : "OFF";
      autoBtn.setAttribute("aria-pressed", String(auto.on));
      $("ch-delay-v").textContent = `${auto.delay} ms`;
      $("ch-last").textContent = auto.last ? `読み取り: ${auto.last}` : "";
      $("ch-plates").textContent = `皿数 ${plates.count}(${plates.limit}皿で自動入力を停止)`;
      for (const b of $("ch-speed").children) b.setAttribute("aria-pressed", String(Number(b.dataset.v) === scale));
    };
    ui.update();
  }

  // ---- ゲーム内の例外からの自動復帰 ----
  // この Unity ビルドは C# の例外を捕まえられず、例外が起きたフレームでメインループごと止まる。
  // 止まっていたら emscripten の resumeMainLoop でループを再開させる。
  // 原因調査のため、エラー内容はサーバー経由で error-log.txt に記録する。
  const errors = { count: 0, recovered: 0 };
  const loadedAt = realPerf();

  function logToServer(text) {
    fetch("/__log", { method: "POST", headers: { "X-Sushida-Log": "1" }, body: text }).catch(() => {});
  }

  function onGameError(msg) {
    msg = String(msg || "");
    console.warn("[game error]", msg);
    // ゲーム本体の例外だけ扱う(音声の読み込み失敗など無害なものは無視)
    if (!/DISABLE_EXCEPTION_CATCHING|exception|abort/i.test(msg)) return;
    errors.count++;
    logToServer([
      `time=${new Date().toISOString()}`,
      `uptime=${((realPerf() - loadedAt) / 1000).toFixed(1)}s speed=${scale} auto=${auto.on} delay=${auto.delay}`,
      `ua=${navigator.userAgent}`,
      `message=${msg}`,
    ].join("\n"));
    setTimeout(checkMainLoop, 300);
  }

  function checkMainLoop(retry = 0) {
    const stopped = realPerf() - lastGameRaf > 250;
    if (!stopped) { ui.gameError(errors, true); return; }
    const mod = window.gameInstance?.Module;
    try { mod?.resumeMainLoop?.(); } catch (e) { console.error(e); }
    setTimeout(() => {
      if (realPerf() - lastGameRaf < 250) { errors.recovered++; ui.gameError(errors, true); }
      else if (retry < 2) checkMainLoop(retry + 1);
      else ui.gameError(errors, false);
    }, 300);
  }

  // ローカルサーバーを止めてゲームを終了する。ブラウザのタブは自分で開いたものではないので
  // スクリプトから閉じられない場合があり、そのときは閉じてよいことを表示する。
  async function quit() {
    auto.on = false;
    try { await fetch("/__quit", { method: "POST", headers: { "X-Sushida-Quit": "1" } }); } catch {}
    document.body.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;background:#1b1b1b;color:#f3e9dc;font:16px system-ui,sans-serif;text-align:center;padding:16px">
      <div><p style="font-size:20px;margin:0 0 8px">寿司打オフラインを終了しました</p><p style="margin:0;color:#a8957f">このタブは閉じてかまいません。もう一度遊ぶときは start.bat をダブルクリックしてください。</p></div></div>`;
    window.close();
  }

  document.addEventListener("DOMContentLoaded", buildPanel);

  window.sushiCheat = {
    get speed() { return scale; },
    set speed(v) { setSpeed(v); ui.update(); },
    get auto() { return auto.on; },
    set auto(v) { setAuto(!!v); },
    set delay(v) { auto.delay = Number(v) || 0; ui.update(); },
    set debug(v) { auto.debug = !!v; },
    onGameError,
    get plates() { return plates.count; },
    set plateLimit(v) { plates.limit = Number(v) || 580; ui.update(); },
    captureRomaji,
  };
})();
