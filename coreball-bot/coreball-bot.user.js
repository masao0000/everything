// ==UserScript==
// @name         Coreball auto-play
// @namespace    coreball-bot
// @version      1.0
// @description  Auto-play for arealme.com coreball. Toggle with the top-right button or the A key.
// @match        https://www.arealme.com/coreball/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// Generated from inject.js by build-userscript.mjs (ASCII only, so copy/paste encoding cannot break it).

window.__cbStandalone = true;
// \u307e\u3061\u91dd\u30b2\u30fc\u30e0 (arealme.com/coreball) \u81ea\u52d5\u30d7\u30ec\u30a4\u7528\u306e\u30da\u30fc\u30b8\u5185\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u3002
// \u30b2\u30fc\u30e0\u3088\u308a\u5148\u306b\u8aad\u307f\u8fbc\u307e\u308c\u3001Canvas \u306e\u63cf\u753b\u547d\u4ee4\u304b\u3089\u91dd\u306e\u89d2\u5ea6\u3092\u8aad\u307f\u53d6\u308a\u3001
// \u7740\u5f3e\u6642\u306b\u65e2\u5b58\u306e\u91dd\u3068\u5f53\u305f\u3089\u306a\u3044\u30bf\u30a4\u30df\u30f3\u30b0\u3067\u30b9\u30da\u30fc\u30b9\u30ad\u30fc\u3092\u9001\u308b\u3002
//
// \u56de\u8ee2\u306e\u5148\u8aad\u307f:
//   \u30b2\u30fc\u30e0\u306f\u30ec\u30d9\u30eb\u958b\u59cb\u6642\u306b COREBALL_FN_START_GAME(config) \u3092\u547c\u3073\u3001config.round \u304c
//   \u56de\u8ee2\u95a2\u6570\u306e\u30d5\u30a1\u30af\u30c8\u30ea\u3002\u3053\u308c\u3067\u300c\u5f71\u306e\u56de\u8ee2\u95a2\u6570\u300d\u3092\u4f5c\u308a\u3001\u30b2\u30fc\u30e0\u3068\u540c\u3058\u5165\u529b
//   (\u30d5\u30ec\u30fc\u30e0\u6642\u9593\u30fb\u30af\u30ea\u30c3\u30af\u6709\u7121) \u3092\u4e0e\u3048\u3066\u672a\u6765\u306e\u89d2\u5ea6\u3092\u6b63\u78ba\u306b\u8a08\u7b97\u3059\u308b\u3002
//   (\u767a\u5c04\u3067\u9006\u56de\u8ee2\u3059\u308b\u30ec\u30d9\u30eb\u3084\u3001\u4e00\u5b9a\u6642\u9593\u3067\u901f\u5ea6\u30fb\u5411\u304d\u304c\u5909\u308f\u308b\u30ec\u30d9\u30eb\u306b\u5bfe\u5fdc)
//   \u5f71\u304c\u305a\u308c\u305f\u5834\u5408\u306f\u3001\u76f4\u8fd1\u306e\u56de\u8ee2\u901f\u5ea6\u306b\u3088\u308b\u7dda\u5f62\u4e88\u6e2c\u306b\u5207\u308a\u66ff\u3048\u308b\u3002
(() => {
  if (window.__cbBot) return;

  const STAGE_ID = "coreball_stage";
  const FLIGHT_MS = 50; // \u5f85\u6a5f\u5217\u304b\u3089\u4e2d\u5fc3\u3078\u98db\u3076\u6642\u9593 (\u30b2\u30fc\u30e0\u5185\u5b9a\u6570)
  const LAND_ANGLE = 90; // \u7740\u5f3e\u4f4d\u7f6e: \u4e2d\u5fc3\u306e\u771f\u4e0b (canvas \u5ea7\u6a19\u3067 90\u00b0)
  const FRAME_MS = 1000 / 60; // \u30b2\u30fc\u30e0\u306e\u57fa\u6e96\u30d5\u30ec\u30fc\u30e0\u6642\u9593
  const MAX_DT = 100; // \u30b2\u30fc\u30e0\u304c 1 \u30d5\u30ec\u30fc\u30e0\u306e\u7d4c\u904e\u6642\u9593\u3092\u5207\u308a\u8a70\u3081\u308b\u4e0a\u9650

  const bot = (window.__cbBot = {
    enabled: false,
    auto: true, // \u81ea\u52d5\u30d7\u30ec\u30a4\u306e ON/OFF (\u753b\u9762\u53f3\u4e0a\u306e\u30dc\u30bf\u30f3 or\u300cA\u300d\u30ad\u30fc\u3067\u5207\u66ff)
    margin: 3, // \u5f53\u305f\u308a\u5224\u5b9a\u306e\u95be\u5024\u306b\u8db3\u3059\u5b89\u5168\u30de\u30fc\u30b8\u30f3 (\u5ea6, \u7dda\u5f62\u4e88\u6e2c\u6642)
    exactMargin: 0.3, // \u540c\u4e0a (\u6b63\u78ba\u306a\u4e88\u6e2c\u6642)
    minMargin: 0.1,
    results: [], // { result: "pass" | "fail", level, shots, model }
    shots: 0,
    debug: false,
    log: [],
  });

  // --- \u63cf\u753b\u306e\u76d7\u307f\u898b -------------------------------------------------------
  // \u30b3\u30a2\u306e\u63cf\u753b\u306f clearRect \u2192 (moveTo, lineTo) \u00d7 \u91dd\u306e\u6570 \u2192 \u4e2d\u5fc3\u7403\u3001\u306e\u9806\u3002
  // \u4e2d\u5fc3\u304b\u3089\u4f38\u3073\u308b\u7dda\u306e\u7d42\u70b9 = \u91dd\u306e\u7389\u306e\u4f4d\u7f6e\u3002
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

  // \u30b2\u30fc\u30e0\u306e rAF \u30b3\u30fc\u30eb\u30d0\u30c3\u30af\u3092\u5305\u307f\u3001\u63cf\u753b\u76f4\u5f8c\u306b\u5224\u5b9a\u3059\u308b (\u9045\u5ef6\u3092\u6700\u5c0f\u5316)\u3002
  // \u540c\u3058\u30d5\u30ec\u30fc\u30e0\u306e\u30b3\u30fc\u30eb\u30d0\u30c3\u30af\u306f\u540c\u3058 ts \u3092\u53d7\u3051\u53d6\u308b\u306e\u3067\u3001ts \u306e\u5909\u5316\u3067\u30d5\u30ec\u30fc\u30e0\u5883\u754c\u3092\u77e5\u308b\u3002
  let curTs = -1;
  let prevTs = -1;
  const origRaf = window.requestAnimationFrame.bind(window);
  const TICK = FRAME_MS + 1e-4;
  let rawPrev = -1;
  let rawDt = FRAME_MS; // \u5b9f\u969b\u306e\u753b\u9762\u306e\u30d5\u30ec\u30fc\u30e0\u9593\u9694 (\u5e73\u5747)
  let quantized = false;
  let phaseShift = 0; // \u6642\u523b\u306b\u8db3\u3059\u7aef\u6570 (\u4f4d\u76f8\u305a\u3089\u3057\u7528, ms)
  function quantizeTs(raw) {
    if (raw !== rawPrev) {
      if (rawPrev > 0) rawDt = rawDt * 0.95 + Math.min(raw - rawPrev, 100) * 0.05;
      rawPrev = raw;
    }
    // 120Hz / 144Hz \u306a\u3069\u306e\u753b\u9762\u3067\u3082 1/60 \u79d2\u523b\u307f\u306b\u305d\u308d\u3048\u308b (\u30b2\u30fc\u30e0\u5185\u306e\u6642\u9593\u306f 0 \u304b 1/60 \u79d2\u5358\u4f4d\u3067\u9032\u3080)
    quantized = bot.quantize !== false;
    return quantized ? Math.round(raw / FRAME_MS) * TICK + phaseShift : raw;
  }
  let curRaw = -1;
  window.requestAnimationFrame = (cb) =>
    origRaf(function tick(rawTs) {
      // 60Hz \u753b\u9762\u3067\u306f\u3001\u30b2\u30fc\u30e0\u306b\u6e21\u3059\u6642\u523b\u3092\u7b49\u9593\u9694 (1/60 \u79d2\u3088\u308a\u308f\u305a\u304b\u306b\u9577\u3044) \u306b\u305d\u308d\u3048\u308b\u3002
      // \u7389\u304c\u523a\u3055\u308b\u306e\u306f\u7d4c\u904e\u6642\u9593\u306e\u5408\u8a08\u304c 50ms \u306b\u9054\u3057\u305f\u30d5\u30ec\u30fc\u30e0\u306a\u306e\u3067\u3001\u5b9f\u6642\u9593\u306e\u63fa\u3089\u304e\u3067
      // 3 \u30d5\u30ec\u30fc\u30e0\u76ee\u304b 4 \u30d5\u30ec\u30fc\u30e0\u76ee\u304b\u304c\u3076\u308c\u308b\u3002\u3053\u308c\u3092\u6bce\u56de 3 \u30d5\u30ec\u30fc\u30e0\u76ee\u306b\u56fa\u5b9a\u3059\u308b\u3002
      let ts = quantizeTs(rawTs);
      // \u63cf\u753b\u304c\u8a70\u307e\u3063\u3066\u30d5\u30ec\u30fc\u30e0\u3092\u98db\u3070\u3057\u3066\u3082\u3001\u30b2\u30fc\u30e0\u306e\u6642\u523b\u306f 1 \u30d5\u30ec\u30fc\u30e0\u306b 1 \u523b\u307f\u3060\u3051\u9032\u3081\u308b
      // (2 \u523b\u307f\u5206\u3092 1 \u56de\u3067\u9032\u3081\u308b\u3068\u3001\u767a\u5c04\u3067\u9006\u56de\u8ee2\u3059\u308b\u30ec\u30d9\u30eb\u306a\u3069\u3067\u5148\u8aad\u307f\u3068\u305a\u308c\u308b)\u3002
      // \u9045\u308c\u305f\u5206\u306f\u305d\u306e\u307e\u307e (\u30b2\u30fc\u30e0\u304c\u5c11\u3057\u9045\u304f\u9032\u3080\u3060\u3051)\u3002
      if (quantized && curTs > 0 && ts > curTs + TICK * 1.5) ts = curTs + TICK;
      // \u91cf\u5b50\u5316\u3067\u524d\u306e\u30d5\u30ec\u30fc\u30e0\u3068\u540c\u3058\u6642\u523b\u306b\u306a\u3063\u305f\u65b0\u3057\u3044\u30d5\u30ec\u30fc\u30e0 (120Hz \u753b\u9762\u3084\u63cf\u753b\u306e\u63fa\u3089\u304e) \u306f
      // \u30b2\u30fc\u30e0\u306b\u6e21\u3055\u305a\u6b21\u306e\u30d5\u30ec\u30fc\u30e0\u3078\u56de\u3059\u3002\u6e21\u3059\u3068\u30b2\u30fc\u30e0\u306f\u7d4c\u904e 0 \u3067 update \u3057\u3001\u30af\u30ea\u30c3\u30af\u3092
      // \u305d\u3053\u3067\u6d88\u8cbb\u3059\u308b\u305f\u3081\u3001\u5f71\u306e\u56de\u8ee2\u95a2\u6570\u3068\u305a\u308c\u308b\u3002
      if (ts === curTs && rawTs !== curRaw) {
        origRaf(tick);
        return;
      }
      if (ts !== curTs) {
        prevTs = curTs;
        curTs = ts;
        curRaw = rawTs;
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

  // --- \u30b2\u30fc\u30e0\u306e\u30d5\u30c3\u30af\u3092\u6a2a\u53d6\u308a ------------------------------------------------
  function hookGlobal(name, before) {
    let fn = window[name]; // \u5f8c\u304b\u3089\u8aad\u307f\u8fbc\u307e\u308c\u305f\u5834\u5408 (\u30e6\u30fc\u30b6\u30fc\u30b9\u30af\u30ea\u30d7\u30c8\u7b49) \u306f\u65e2\u5b58\u306e\u95a2\u6570\u3092\u5305\u3080
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
  // \u30ec\u30d9\u30eb\u958b\u59cb: config.round = \u56de\u8ee2\u95a2\u6570\u30d5\u30a1\u30af\u30c8\u30ea
  hookGlobal("COREBALL_FN_START_GAME", (config) => {
    startRound(config && typeof config.round === "function" ? config.round : null);
    roundQueue = config && typeof config.queueCount === "number" ? config.queueCount : 0;
    roundInitial = config && Array.isArray(config.childs) ? config.childs.length : 0;
    roundShots = 0;
  });
  // \u30ec\u30d9\u30eb\u7d42\u4e86: (result, level)
  hookGlobal("COREBALL_FN_STOP_GAME", (result, level) => {
    bot.results.push({ result, level, shots: bot.shots, model: shadow ? (shadow.ok ? "exact" : "fallback") : "none" });
  });

  // --- \u5f71\u306e\u56de\u8ee2\u95a2\u6570 -------------------------------------------------------
  // hist: \u30b2\u30fc\u30e0\u304c\u56de\u8ee2\u95a2\u6570\u3092\u547c\u3093\u3060\u3068\u304d\u306e\u5f15\u6570 [x, E, frameFactor, clicked] \u306e\u5c65\u6b74
  let shadow = null; // { factory, hist, offset, ok, now }
  let clickPending = false;
  let roundQueue = 0; // \u3053\u306e\u30ec\u30d9\u30eb\u3067\u6483\u3064\u7389\u306e\u7dcf\u6570
  let roundShots = 0; // \u3053\u306e\u30ec\u30d9\u30eb\u3067\u6483\u3063\u305f\u6570
  let roundInitial = 0; // \u6700\u521d\u304b\u3089\u523a\u3055\u3063\u3066\u3044\u308b\u91dd\u306e\u6570

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

  // \u958b\u59cb\u30d5\u30ec\u30fc\u30e0\u304c 1\u301c2 \u30d5\u30ec\u30fc\u30e0\u305a\u308c\u3066\u3044\u305f\u5834\u5408\u306f\u5c65\u6b74\u3092\u305a\u3089\u3057\u3066\u5408\u308f\u305b\u76f4\u3059
  function resync(obs) {
    const base = shadow.hist;
    const cands = [base.slice(1), base.slice(2), [base[0], ...base], [base[0], base[0], ...base]];
    for (const h of cands) {
      if (!h.length) continue;
      const now = replay(h);
      const off = norm(obs - now);
      // offset \u306f\u6700\u521d\u306e\u91dd\u3067\u6c7a\u3081\u305f\u5024\u3002\u5dee\u3057\u66ff\u3048\u5f8c\u3082\u305d\u308c\u3068\u4e00\u81f4\u3059\u308b\u304b\u78ba\u8a8d
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

  // --- \u5224\u5b9a\u30ed\u30b8\u30c3\u30af -------------------------------------------------------
  const norm = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  let prev = null; // { ts, angles }
  let omega = 0; // \u5ea6/ms (\u7dda\u5f62\u4e88\u6e2c\u7528)
  let samples = 0; // \u9023\u7d9a\u3057\u3066\u89b3\u6e2c\u3067\u304d\u305f\u30d5\u30ec\u30fc\u30e0\u6570
  let frameDt = FRAME_MS;
  let inFlight = null; // { ts, count, frames }
  const landK = []; // \u5b9f\u969b\u306b\u4f55\u30d5\u30ec\u30fc\u30e0\u5f8c\u306b\u523a\u3055\u3063\u305f\u304b\u306e\u8a18\u9332 (\u76f4\u8fd1)
  let waitingSince = 0;
  let lastShiftAt = 0;

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

    // \u5f71\u3092 1 \u30d5\u30ec\u30fc\u30e0\u9032\u3081\u308b (\u30b2\u30fc\u30e0\u306e update \u3068\u540c\u3058\u5f15\u6570)
    if (shadow && running) {
      const [x, E] = speedRatio();
      shadow.hist.push([x, E, dt / FRAME_MS, clickPending]);
      clickPending = false;
      if (shadow.ok) {
        shadow.now = replay(shadow.hist);
        // \u6700\u521d\u306e\u91dd\u3067\u89d2\u5ea6\u306e\u305a\u308c (\u91dd\u81ea\u8eab\u306e\u89d2\u5ea6) \u3092\u5408\u308f\u305b\u3001\u4ee5\u5f8c\u306f\u305a\u308c\u691c\u51fa\u306b\u4f7f\u3046
        if (angles.length) {
          if (shadow.offset === null) shadow.offset = angles[0] - shadow.now;
          else if (Math.abs(norm(angles[0] - shadow.now - shadow.offset)) > 0.5 && !resync(angles[0])) {
            shadow.ok = false; // \u540c\u671f\u304c\u5d29\u308c\u305f \u2192 \u7dda\u5f62\u4e88\u6e2c\u3078
            if (bot.debug) bot.log.push({ ts, desync: norm(angles[0] - shadow.now - shadow.offset) });
          }
        }
      }
    }

    // \u7dda\u5f62\u4e88\u6e2c\u7528\u306e\u56de\u8ee2\u901f\u5ea6 (\u540c\u3058\u6dfb\u5b57 = \u540c\u3058\u91dd)
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

    // \u81ea\u52d5 OFF \u4e2d\u306f\u89b3\u6e2c\u3060\u3051\u7d9a\u3051\u3001\u6483\u305f\u306a\u3044 (\u624b\u52d5\u30d7\u30ec\u30a4\u4e2d\u3082\u5148\u8aad\u307f\u306e\u540c\u671f\u3092\u4fdd\u3064)
    if (!bot.auto) {
      waitingSince = 0;
      return;
    }

    // \u767a\u5c04\u6e08\u307f\u306e\u7389\u304c\u523a\u3055\u308b\u307e\u3067 (= \u91dd\u304c\u5897\u3048\u308b\u307e\u3067) \u5f85\u3064
    if (inFlight) {
      inFlight.frames++;
      if (angles.length > inFlight.count) {
        // \u523a\u3055\u3063\u305f\u30d5\u30ec\u30fc\u30e0\u6570\u3092\u8a18\u9332 (\u7740\u5f3e\u30bf\u30a4\u30df\u30f3\u30b0\u306e\u63fa\u3089\u304e\u3092\u5b66\u7fd2\u3059\u308b)
        if (inFlight.count > 0) {
          landK.push(inFlight.frames);
          if (landK.length > 6) landK.shift();
        }
        inFlight = null;
      } else if (ts - inFlight.ts > 300) inFlight = null;
      else return;
    }

    // \u91dd\u304c\u307e\u3060 1 \u672c\u3082\u7121\u3051\u308c\u3070\u3069\u3053\u306b\u523a\u3057\u3066\u3082\u5b89\u5168
    if (!angles.length) {
      fire(ts, 0, Infinity, 0);
      return;
    }

    const exact = shadow && shadow.ok && shadow.offset !== null;
    if (!exact && samples < 3) return; // \u901f\u5ea6\u306e\u63a8\u5b9a\u304c\u5b89\u5b9a\u3059\u308b\u307e\u3067\u6483\u305f\u306a\u3044

    // \u5f53\u305f\u308a\u5224\u5b9a: \u7740\u5f3e\u3057\u305f\u7389\u306f\u4e2d\u5fc3\u304b\u3089 164s \u771f\u4e0b\u3001\u65e2\u5b58\u306e\u91dd\u306f\u534a\u5f84 150s\u3002
    // \u8ddd\u96e2 <= ceil(24s)+ceil(2s) \u3067\u885d\u7a81 (s = R/150)\u3002\u3053\u308c\u3092\u89d2\u5ea6\u306b\u63db\u7b97\u3002
    const s = R / 150;
    const f = Math.ceil(24 * s) + Math.ceil(2 * s);
    const a = 150 * s;
    const b = 164 * s;
    const cos = (a * a + b * b - f * f) / (2 * a * b);
    const hitAngle = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;

    // \u7389\u306f\u6b21\u30d5\u30ec\u30fc\u30e0\u304b\u3089\u98db\u3073\u59cb\u3081\u3001\u7d4c\u904e\u6642\u9593\u304c 50ms \u306b\u9054\u3057\u305f\u30d5\u30ec\u30fc\u30e0\u3067\u523a\u3055\u308b\u3002
    // \u30d5\u30ec\u30fc\u30e0\u6642\u9593\u306e\u63fa\u3089\u304e\u3067\u524d\u5f8c\u3059\u308b\u306e\u3067\u3001\u5019\u88dc\u306e\u30d5\u30ec\u30fc\u30e0\u6570\u3059\u3079\u3066\u3067\u5b89\u5168\u304b\u78ba\u8a8d\u3059\u308b\u3002
    // \u76f4\u8fd1\u306e\u7740\u5f3e\u304c\u6bce\u56de\u540c\u3058\u30d5\u30ec\u30fc\u30e0\u6570\u306a\u3089\u3001\u305d\u308c\u3060\u3051\u3092\u78ba\u8a8d\u3059\u308b (\u5bc6\u96c6\u30ec\u30d9\u30eb\u3067\u9699\u9593\u3092\u5e83\u304f\u4f7f\u3048\u308b)
    // \u7d4c\u904e\u6642\u9593\u306e\u5408\u8a08\u304c 50ms \u306b\u9054\u3057\u305f\u30d5\u30ec\u30fc\u30e0\u3067\u523a\u3055\u308b\u300250/\u30d5\u30ec\u30fc\u30e0\u6642\u9593 \u304c\u6574\u6570\u306b\u8fd1\u3044\u3068\u304d\u3060\u3051\u524d\u5f8c 2 \u901a\u308a\u3092\u8003\u3048\u308b
    const q = FLIGHT_MS / frameDt;
    const near = Math.abs(q - Math.round(q)) < 0.08;
    let kMin = Math.max(1, near ? Math.round(q) : Math.ceil(q));
    let kMax = near ? kMin + 1 : kMin;
    // \u6642\u523b\u3092\u305d\u308d\u3048\u3066\u3044\u308b\u3068\u304d\u306f\u7740\u5f3e\u30d5\u30ec\u30fc\u30e0\u304c\u78ba\u5b9a\u3059\u308b (50 / 16.6667 \u2192 3 \u30d5\u30ec\u30fc\u30e0)
    if (quantized) kMin = kMax = Math.ceil(FLIGHT_MS / TICK);
    const [x, E] = speedRatio();
    // delay \u30d5\u30ec\u30fc\u30e0\u5f85\u3063\u3066\u304b\u3089\u6483\u3063\u305f\u5834\u5408\u306e\u3001\u7740\u5f3e\u6642\u306e\u6700\u5c0f\u96e2\u89d2
    const clearanceAt = (delay) => {
      let c = Infinity;
      const base = exact ? replay(shadow.hist) : 0;
      for (let k = kMin; k <= kMax; k++) {
        let rot;
        if (exact) {
          const extra = [];
          for (let j = 0; j < delay + k; j++) extra.push([x, E, (quantized ? TICK : frameDt) / FRAME_MS, j === delay]);
          rot = replay(shadow.hist, extra) - base;
        } else {
          rot = omega * (delay + k) * frameDt;
        }
        for (const th of angles) c = Math.min(c, Math.abs(norm(th + rot - LAND_ANGLE)));
        lastRot = rot;
      }
      return c;
    };
    let lastRot = 0;
    const clearance = clearanceAt(0);

    // \u8a70\u3081\u8fbc\u307f\u306e\u5148\u8aad\u307f: \u9699\u9593 G \u306b\u306f (floor(G/h) - 1) \u672c\u307e\u3067\u5165\u308b (h = \u6700\u5c0f\u9593\u9694)\u3002
    // \u3053\u3053\u306b\u523a\u3059\u3068\u6b8b\u308a\u306e\u7389\u304c\u5165\u308a\u304d\u3089\u306a\u304f\u306a\u308b\u306a\u3089\u6483\u305f\u305a\u306b\u5f85\u3064\u3002
    let packOk = true;
    const remaining = roundQueue - roundShots; // \u3053\u306e 1 \u767a\u3092\u542b\u3080\u6b8b\u308a
    if (exact && remaining > 1) {
      const h = hitAngle + bot.exactMargin;
      const cap = (g) => Math.max(0, Math.floor(g / h - 1e-9) - 1);
      const pos = angles.map((th) => (((th + lastRot - LAND_ANGLE) % 360) + 360) % 360).sort((p, q) => p - q);
      let capBefore = 0;
      for (let i = 0; i < pos.length; i++) capBefore += cap(i ? pos[i] - pos[i - 1] : pos[0] + 360 - pos[pos.length - 1]);
      // \u7740\u5f3e\u70b9 (0\u00b0) \u3092\u631f\u3080\u9699\u9593: \u6700\u5f8c\u306e\u91dd \u2192 360\u00b0\u30010\u00b0 \u2192 \u6700\u521d\u306e\u91dd
      const a = 360 - pos[pos.length - 1];
      const b = pos[0];
      const capAfter = capBefore - cap(a + b) + cap(a) + cap(b);
      // \u3082\u3068\u3082\u3068\u5165\u308a\u304d\u3089\u306a\u3044\u72b6\u6cc1\u306a\u3089\u5236\u9650\u3057\u306a\u3044 (\u3044\u3064\u3082\u901a\u308a\u6483\u3064)
      if (capBefore >= remaining && capAfter < remaining - 1) packOk = false;

      // \u4f59\u88d5\u304c\u5c11\u306a\u3044\u30ec\u30d9\u30eb (\u5e73\u5747\u9593\u9694 < \u6700\u5c0f\u9593\u9694\u306e 2 \u500d) \u3067\u306f\u3001\u6700\u5f8c\u306e\u672c\u6570\u3067\u5186\u3092\u7b49\u5206\u3057\u305f
      // \u300c\u30de\u30b9\u76ee\u300d\u306b\u523a\u3059\u3002\u6700\u521d\u306e\u91dd\u3092\u30de\u30b9\u76ee\u306e\u57fa\u6e96\u306b\u3059\u308b\u3002\u521d\u671f\u914d\u7f6e\u304c\u30de\u30b9\u76ee\u306b\u4e57\u3089\u306a\u3044\u3068\u304d\u306f\u4f7f\u308f\u306a\u3044\u3002
      const T = roundInitial + roundQueue;
      const S = 360 / T;
      const tol = (S - h) / 2;
      if (T > 0 && S < 2 * h && tol > 0.2) {
        const p0 = (((angles[0] + lastRot - LAND_ANGLE) % 360) + 360) % 360;
        const off = (p) => {
          const r = (((p - p0) % S) + S) % S;
          return Math.min(r, S - r);
        };
        const onGrid = angles.every((th) => off((((th + lastRot - LAND_ANGLE) % 360) + 360) % 360) <= tol + 0.5);
        if (onGrid) packOk = off(0) <= tol;
      }
    }

    if (!waitingSince) waitingSince = ts;
    // \u306a\u304b\u306a\u304b\u6483\u3066\u306a\u3044\u5bc6\u96c6\u30ec\u30d9\u30eb\u3067\u306f\u30de\u30fc\u30b8\u30f3\u3092\u5c11\u3057\u305a\u3064\u7de9\u3081\u308b
    const waited = ts - waitingSince;
    // \u6b63\u78ba\u306a\u4e88\u6e2c\u304c\u52b9\u3044\u3066\u3044\u308b\u3068\u304d\u306f\u8a70\u3081\u3066\u523a\u3059 (\u9699\u9593\u3092\u6b8b\u3059\u3068\u7d42\u76e4\u306b\u5165\u3089\u306a\u304f\u306a\u308b)
    const baseMargin = exact ? bot.exactMargin : bot.margin;
    const margin = Math.max(bot.minMargin, baseMargin - Math.floor(waited / 1500));

    const ok = clearance > hitAngle + margin && packOk;
    // \u56de\u8ee2\u3068\u91dd\u306e\u914d\u7f6e\u304c\u5468\u671f\u7684\u306b\u4e00\u81f4\u3059\u308b\u30ec\u30d9\u30eb\u3067\u306f\u30011/60 \u79d2\u523b\u307f\u306e\u6642\u523b\u3060\u3068\u7740\u5f3e\u4f4d\u7f6e\u304c
    // \u6bce\u5468\u671f\u540c\u3058\u306b\u306a\u308a\u3001\u6c38\u4e45\u306b\u6483\u3066\u306a\u3044\u3053\u3068\u304c\u3042\u308b\u3002\u3057\u3070\u3089\u304f\u6483\u3066\u306a\u3051\u308c\u3070\u30b2\u30fc\u30e0\u306b\u6e21\u3059
    // \u6642\u523b\u3092\u7aef\u6570\u30d5\u30ec\u30fc\u30e0\u3060\u3051\u305a\u3089\u3057\u3001\u7740\u5f3e\u4f4d\u7f6e\u306e\u4e26\u3073\u3092\u5909\u3048\u308b (\u6b21\u30d5\u30ec\u30fc\u30e0\u306e dt \u304c\u4f38\u3073\u308b)\u3002
    if (!ok && quantized && waited > 700 && ts - lastShiftAt > 700) {
      phaseShift += FRAME_MS * 0.37;
      lastShiftAt = ts;
      return;
    }

    // \u4fdd\u967a: \u9577\u304f\u6483\u3066\u306a\u3051\u308c\u3070 (\u56de\u8ee2\u505c\u6b62\u306a\u3069\u3067\u5224\u5b9a\u304c\u8a70\u307e\u3063\u305f\u5834\u5408) \u6483\u3064\u3002
    // \u56de\u8ee2\u304c\u9045\u3044\u30ec\u30d9\u30eb\u3067\u306f\u7a74\u304c\u7740\u5f3e\u70b9\u306b\u6765\u308b\u307e\u3067 1 \u5468 (5 \u79d2\u4ee5\u4e0a) \u304b\u304b\u308b\u306e\u3067\u30011 \u5468\u534a\u306f\u5f85\u3064\u3002
    const turnMs = Math.abs(omega) > 1e-4 ? 360 / Math.abs(omega) : Infinity;
    const giveUp = Math.min(20000, Math.max(5000, turnMs * 1.5));
    if (ok || waited > giveUp) fire(ts, angles.length, clearance, hitAngle, exact);
  }

  function fire(ts, count, clearance, hitAngle, exact) {
    if (bot.debug) bot.log.push({ ts, count, clearance, hitAngle, exact, omega });
    bot.shots++;
    roundShots++;
    clickPending = true; // \u30b2\u30fc\u30e0\u306f\u6b21\u306e\u30d5\u30ec\u30fc\u30e0\u3067\u300c\u30af\u30ea\u30c3\u30af\u3042\u308a\u300d\u3068\u3057\u3066\u56de\u8ee2\u95a2\u6570\u3092\u547c\u3076
    inFlight = { ts, count, frames: 0 };
    waitingSince = 0;
    const ev = new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true });
    document.body.dispatchEvent(ev);
  }

  // \u624b\u52d5\u306e\u767a\u5c04\u3082\u30b2\u30fc\u30e0\u306e\u56de\u8ee2\u306b\u5f71\u97ff\u3059\u308b\u306e\u3067\u3001\u5f71\u306e\u5165\u529b\u306b\u53cd\u6620\u3059\u308b
  const markManual = (e) => {
    if (e.isTrusted) clickPending = true;
  };
  document.addEventListener("keydown", (e) => e.keyCode === 32 && markManual(e), true);
  document.addEventListener("mousedown", (e) => e.target && e.target.id === STAGE_ID && markManual(e), true);
  document.addEventListener("touchstart", (e) => e.target && e.target.id === STAGE_ID && markManual(e), true);

  // --- ON/OFF \u5207\u66ff --------------------------------------------------------
  let btn = null;
  function render() {
    if (!btn) return;
    btn.textContent = bot.auto ? "\u81ea\u52d5: ON (A)" : "\u81ea\u52d5: OFF (A)";
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
    // \u30b2\u30fc\u30e0\u306e mousedown (\u767a\u5c04) \u306b\u62fe\u308f\u308c\u306a\u3044\u3088\u3046\u4f1d\u64ad\u3092\u6b62\u3081\u308b
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

  // --- \u5358\u4f53\u30e2\u30fc\u30c9 (\u30e6\u30fc\u30b6\u30fc\u30b9\u30af\u30ea\u30d7\u30c8\u3067\u81ea\u5206\u306e\u30d6\u30e9\u30a6\u30b6\u306b\u5165\u308c\u305f\u5834\u5408) ----------
  // Playwright \u306e\u4ee3\u308f\u308a\u306b\u3001\u30da\u30fc\u30b8\u5185\u3067\u300c\u30d7\u30ec\u30a4\u300d\u30dc\u30bf\u30f3\u3092\u62bc\u3057\u3066\u6b21\u3005\u30ec\u30d9\u30eb\u3092\u9032\u3081\u308b
  if (window.__cbStandalone) {
    bot.enabled = true;
    let pressedAt = 0;
    setInterval(() => {
      if (!bot.auto) return;
      const canvas = document.getElementById(STAGE_ID);
      const play = document.getElementById("coreball_playbutton");
      if (!play || (canvas && canvas.style.display !== "none")) return;
      if (Date.now() - pressedAt < 3000) return;
      // \u30b9\u30ad\u30f3\u7372\u5f97\u306a\u3069\u306e\u30dd\u30c3\u30d7\u30a2\u30c3\u30d7\u3092\u9589\u3058\u308b
      document.querySelectorAll(".panel-mask").forEach((m) => {
        if (m.style.display !== "none" && m.dataset.disableClose !== "1") m.click();
      });
      pressedAt = Date.now();
      bot.reset();
      play.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, 1000);
  }

  bot.reset = () => {
    bot.shots = 0;
    prev = null;
    samples = 0;
    omega = 0;
    inFlight = null;
    waitingSince = 0;
  };
})();
