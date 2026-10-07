// まち針ゲーム (arealme.com/coreball) 自動プレイ用のページ内エージェント。
// ゲームより先に読み込まれ、Canvas の描画命令から針の角度を読み取り、
// 着弾時に既存の針と当たらないタイミングでスペースキーを送る。
//
// 回転の先読み:
//   ゲームはレベル開始時に COREBALL_FN_START_GAME(config) を呼び、config.round が
//   回転関数のファクトリ。これで「影の回転関数」を作り、ゲームと同じ入力
//   (フレーム時間・クリック有無) を与えて未来の角度を正確に計算する。
//   (発射で逆回転するレベルや、一定時間で速度・向きが変わるレベルに対応)
//   影がずれた場合は、直近の回転速度による線形予測に切り替える。
(() => {
  if (window.__cbBot) return;

  const STAGE_ID = "coreball_stage";
  const FLIGHT_MS = 50; // 待機列から中心へ飛ぶ時間 (ゲーム内定数)
  const LAND_ANGLE = 90; // 着弾位置: 中心の真下 (canvas 座標で 90°)
  const FRAME_MS = 1000 / 60; // ゲームの基準フレーム時間
  const MAX_DT = 100; // ゲームが 1 フレームの経過時間を切り詰める上限

  const bot = (window.__cbBot = {
    enabled: false,
    auto: true, // 自動プレイの ON/OFF (画面右上のボタン or「A」キーで切替)
    margin: 3, // 当たり判定の閾値に足す安全マージン (度, 線形予測時)
    exactMargin: 1, // 同上 (正確な予測時)
    minMargin: 0.5,
    results: [], // { result: "pass" | "fail", level, shots, model }
    shots: 0,
    debug: false,
    log: [],
  });

  // --- 描画の盗み見 -------------------------------------------------------
  // コアの描画は clearRect → (moveTo, lineTo) × 針の数 → 中心球、の順。
  // 中心から伸びる線の終点 = 針の玉の位置。
  const proto = CanvasRenderingContext2D.prototype;
  const origClear = proto.clearRect;
  const origMove = proto.moveTo;
  const origLine = proto.lineTo;
  let lines = null;
  let moveFrom = null;
  let drewThisTick = false;

  const isStage = (ctx) => ctx.canvas && ctx.canvas.id === STAGE_ID;
  proto.clearRect = function (...a) {
    if (isStage(this)) {
      lines = [];
      moveFrom = null;
      drewThisTick = true;
    }
    return origClear.apply(this, a);
  };
  proto.moveTo = function (x, y) {
    if (lines && isStage(this)) moveFrom = [x, y];
    return origMove.call(this, x, y);
  };
  proto.lineTo = function (x, y) {
    if (lines && moveFrom && isStage(this)) {
      lines.push([moveFrom[0], moveFrom[1], x, y]);
      moveFrom = null;
    }
    return origLine.call(this, x, y);
  };

  // ゲームの rAF コールバックを包み、描画直後に判定する (遅延を最小化)。
  // 同じフレームのコールバックは同じ ts を受け取るので、ts の変化でフレーム境界を知る。
  let curTs = -1;
  let prevTs = -1;
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    origRaf((ts) => {
      if (ts !== curTs) {
        prevTs = curTs;
        curTs = ts;
      }
      drewThisTick = false;
      cb(ts);
      if (drewThisTick) {
        try {
          onFrame(ts);
        } catch (e) {
          bot.log.push(String(e && e.stack ? e.stack : e));
        }
      }
    });

  // --- ゲームのフックを横取り ------------------------------------------------
  function hookGlobal(name, before) {
    let fn;
    const wrapped = function () {
      before.apply(this, arguments);
      return fn.apply(this, arguments);
    };
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => fn && wrapped,
      set: (v) => (fn = v),
    });
  }
  // レベル開始: config.round = 回転関数ファクトリ
  hookGlobal("COREBALL_FN_START_GAME", (config) => {
    startRound(config && typeof config.round === "function" ? config.round : null);
  });
  // レベル終了: (result, level)
  hookGlobal("COREBALL_FN_STOP_GAME", (result, level) => {
    bot.results.push({ result, level, shots: bot.shots, model: shadow ? (shadow.ok ? "exact" : "fallback") : "none" });
  });

  // --- 影の回転関数 -------------------------------------------------------
  // hist: ゲームが回転関数を呼んだときの引数 [x, E, frameFactor, clicked] の履歴
  let shadow = null; // { factory, hist, offset, ok, now }
  let clickPending = false;

  function startRound(factory) {
    shadow = factory ? { factory, hist: [], offset: null, ok: true, now: 0 } : null;
    clickPending = false;
  }

  function replay(hist, extra) {
    const h = shadow.factory();
    let a = 0;
    for (const e of hist) a = h(e[0], e[1], e[2], e[3]);
    if (extra) for (const e of extra) a = h(e[0], e[1], e[2], e[3]);
    return a;
  }

  // 開始フレームが 1〜2 フレームずれていた場合は履歴をずらして合わせ直す
  function resync(obs) {
    const base = shadow.hist;
    const cands = [base.slice(1), base.slice(2), [base[0], ...base], [base[0], base[0], ...base]];
    for (const h of cands) {
      if (!h.length) continue;
      const now = replay(h);
      const off = norm(obs - now);
      // offset は最初の針で決めた値。差し替え後もそれと一致するか確認
      const h1 = h.slice(0, -1);
      if (Math.abs(norm(off - shadow.offset)) < 0.5 || h1.length === 0) {
        shadow.hist = h;
        shadow.now = now;
        return true;
      }
    }
    return false;
  }

  const speedRatio = () => {
    try {
      const r = window.COREBALL_FN_SPEED_RATIO && window.COREBALL_FN_SPEED_RATIO();
      return r && r.length === 2 ? r : [1, 1];
    } catch {
      return [1, 1];
    }
  };

  // --- 判定ロジック -------------------------------------------------------
  const norm = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  let prev = null; // { ts, angles }
  let omega = 0; // 度/ms (線形予測用)
  let samples = 0; // 連続して観測できたフレーム数
  let frameDt = FRAME_MS;
  let inFlight = null; // { ts, count }
  let waitingSince = 0;

  function onFrame(ts) {
    const canvas = document.getElementById(STAGE_ID);
    if (!bot.enabled || !canvas || canvas.style.display === "none" || !lines) {
      prev = null;
      samples = 0;
      return;
    }
    const running = canvas.style.backgroundColor === "rgb(0, 0, 0)";

    const [cx, cy] = lines.length ? lines[0] : [0, 0];
    const angles = lines.map(([, , x, y]) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI);
    const R = lines.length ? Math.hypot(lines[0][2] - cx, lines[0][3] - cy) : 0;
    const dtRaw = prevTs > 0 ? curTs - prevTs : FRAME_MS;
    const dt = Math.min(dtRaw, MAX_DT);
    frameDt = frameDt * 0.9 + dt * 0.1;

    // 影を 1 フレーム進める (ゲームの update と同じ引数)
    if (shadow && running) {
      const [x, E] = speedRatio();
      shadow.hist.push([x, E, dt / FRAME_MS, clickPending]);
      clickPending = false;
      if (shadow.ok) {
        shadow.now = replay(shadow.hist);
        // 最初の針で角度のずれ (針自身の角度) を合わせ、以後はずれ検出に使う
        if (angles.length) {
          if (shadow.offset === null) shadow.offset = angles[0] - shadow.now;
          else if (Math.abs(norm(angles[0] - shadow.now - shadow.offset)) > 0.5 && !resync(angles[0])) {
            shadow.ok = false; // 同期が崩れた → 線形予測へ
            if (bot.debug) bot.log.push({ ts, desync: norm(angles[0] - shadow.now - shadow.offset) });
          }
        }
      }
    }

    // 線形予測用の回転速度 (同じ添字 = 同じ針)
    if (prev && ts > prev.ts) {
      const n = Math.min(angles.length, prev.angles.length);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += norm(angles[i] - prev.angles[i]);
      if (n) omega = sum / n / (ts - prev.ts);
      samples++;
    } else {
      samples = 1;
    }
    prev = { ts, angles };

    if (!running) {
      inFlight = null;
      return;
    }

    // 自動 OFF 中は観測だけ続け、撃たない (手動プレイ中も先読みの同期を保つ)
    if (!bot.auto) {
      waitingSince = 0;
      return;
    }

    // 発射済みの玉が刺さるまで (= 針が増えるまで) 待つ
    if (inFlight) {
      if (angles.length > inFlight.count || ts - inFlight.ts > 300) inFlight = null;
      else return;
    }

    // 針がまだ 1 本も無ければどこに刺しても安全
    if (!angles.length) {
      fire(ts, 0, Infinity, 0);
      return;
    }

    const exact = shadow && shadow.ok && shadow.offset !== null;
    if (!exact && samples < 3) return; // 速度の推定が安定するまで撃たない

    // 当たり判定: 着弾した玉は中心から 164s 真下、既存の針は半径 150s。
    // 距離 <= ceil(24s)+ceil(2s) で衝突 (s = R/150)。これを角度に換算。
    const s = R / 150;
    const f = Math.ceil(24 * s) + Math.ceil(2 * s);
    const a = 150 * s;
    const b = 164 * s;
    const cos = (a * a + b * b - f * f) / (2 * a * b);
    const hitAngle = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;

    // 玉は次フレームから飛び始め、経過時間が 50ms に達したフレームで刺さる。
    // フレーム時間の揺らぎで前後するので、候補のフレーム数すべてで安全か確認する。
    const kMin = Math.max(1, Math.floor(FLIGHT_MS / frameDt));
    const kMax = Math.ceil(FLIGHT_MS / frameDt) + 1;
    const [x, E] = speedRatio();
    // delay フレーム待ってから撃った場合の、着弾時の最小離角
    const clearanceAt = (delay) => {
      let c = Infinity;
      const base = exact ? replay(shadow.hist) : 0;
      for (let k = kMin; k <= kMax; k++) {
        let rot;
        if (exact) {
          const extra = [];
          for (let j = 0; j < delay + k; j++) extra.push([x, E, frameDt / FRAME_MS, j === delay]);
          rot = replay(shadow.hist, extra) - base;
        } else {
          rot = omega * (delay + k) * frameDt;
        }
        for (const th of angles) c = Math.min(c, Math.abs(norm(th + rot - LAND_ANGLE)));
      }
      return c;
    };
    const clearance = clearanceAt(0);

    if (!waitingSince) waitingSince = ts;
    // なかなか撃てない密集レベルではマージンを少しずつ緩める
    const waited = ts - waitingSince;
    // 正確な予測が効いているときは詰めて刺す (隙間を残すと終盤に入らなくなる)
    const baseMargin = exact ? bot.exactMargin : bot.margin;
    const margin = Math.max(bot.minMargin, baseMargin - Math.floor(waited / 1500));

    // 保険: 5 秒撃てなければ (回転停止などで判定が詰まった場合) 撃つ
    if (clearance > hitAngle + margin || waited > 5000) fire(ts, angles.length, clearance, hitAngle, exact);
  }

  function fire(ts, count, clearance, hitAngle, exact) {
    if (bot.debug) bot.log.push({ ts, count, clearance, hitAngle, exact, omega });
    bot.shots++;
    clickPending = true; // ゲームは次のフレームで「クリックあり」として回転関数を呼ぶ
    inFlight = { ts, count };
    waitingSince = 0;
    const ev = new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true });
    document.body.dispatchEvent(ev);
  }

  // 手動の発射もゲームの回転に影響するので、影の入力に反映する
  const markManual = (e) => {
    if (e.isTrusted) clickPending = true;
  };
  document.addEventListener("keydown", (e) => e.keyCode === 32 && markManual(e), true);
  document.addEventListener("mousedown", (e) => e.target && e.target.id === STAGE_ID && markManual(e), true);
  document.addEventListener("touchstart", (e) => e.target && e.target.id === STAGE_ID && markManual(e), true);

  // --- ON/OFF 切替 --------------------------------------------------------
  let btn = null;
  function render() {
    if (!btn) return;
    btn.textContent = bot.auto ? "自動: ON (A)" : "自動: OFF (A)";
    btn.style.background = bot.auto ? "#1a7f37" : "#555";
  }
  bot.setAuto = (on) => {
    bot.auto = on;
    waitingSince = 0;
    render();
  };
  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.key === "a" || e.key === "A") && !/INPUT|TEXTAREA/.test(e.target.tagName)) bot.setAuto(!bot.auto);
    },
    true,
  );
  function mountButton() {
    btn = document.createElement("button");
    btn.id = "cb-bot-toggle";
    btn.style.cssText =
      "position:fixed;top:10px;right:10px;z-index:2147483647;padding:8px 14px;border:none;border-radius:8px;" +
      "color:#fff;font:bold 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 6px #0006;";
    // ゲームの mousedown (発射) に拾われないよう伝播を止める
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      bot.setAuto(!bot.auto);
    });
    for (const ev of ["mousedown", "touchstart", "click"]) btn.addEventListener(ev, (e) => e.stopPropagation());
    document.body.appendChild(btn);
    render();
  }
  if (document.body) mountButton();
  else document.addEventListener("DOMContentLoaded", mountButton);

  bot.reset = () => {
    bot.shots = 0;
    prev = null;
    samples = 0;
    omega = 0;
    inFlight = null;
    waitingSince = 0;
  };
})();
