// ==UserScript==
// @name         Vocab Auto Answer
// @namespace    https://github.com/masao0000/everything
// @version      1.7.0
// @description  英語の空所補充4択問題を読み取り、Claude APIで正解を判定して自動選択する
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.anthropic.com
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ↓ここにClaude APIキー(sk-ant-...)を直接貼り付け (https://console.anthropic.com で発行)
  const API_KEY = 'ここにAPIキー';
  const DEFAULT_MODEL = 'claude-sonnet-5-5';
  const BLANK_RE = /\(\s*\)|（\s*）|_{2,}/;

  // 画面移動時の「このサイトを離れますか？」ポップアップを無効化
  (function blockBeforeUnload() {
    const w = unsafeWindow;
    const origAdd = w.EventTarget.prototype.addEventListener;
    w.EventTarget.prototype.addEventListener = function (type, ...args) {
      if (type === 'beforeunload') return;
      return origAdd.call(this, type, ...args);
    };
    Object.defineProperty(w, 'onbeforeunload', { get: () => null, set: () => {}, configurable: true });
  })();

  // alertの代わりに画面下に数秒だけメッセージを出す
  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483647;' +
      'background:#333;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;max-width:80vw;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  GM_registerMenuCommand('モデルを変更', () => {
    const m = prompt('Claudeモデル名', GM_getValue('model', DEFAULT_MODEL));
    if (m !== null) GM_setValue('model', m.trim() || DEFAULT_MODEL);
  });
  GM_registerMenuCommand('解答する', run);

  // 子要素を持たない短いテキスト要素 = 選択肢候補
  function isLeafOption(el) {
    const t = el.textContent.trim();
    return t && t.length < 40 && !BLANK_RE.test(t) &&
      [...el.children].every((c) => !c.textContent.trim()) && el.offsetParent !== null;
  }

  // 同じ親の下に選択肢が4つ並ぶ箇所を探し、その上にある問題文と組にする
  function extractQuestions() {
    const groups = new Map();
    document.querySelectorAll('body *').forEach((el) => {
      if (!isLeafOption(el)) return;
      // ボタン的な要素まで遡る
      let opt = el;
      while (opt.parentElement && opt.parentElement.textContent.trim() === el.textContent.trim()) opt = opt.parentElement;
      const parent = opt.parentElement;
      if (!parent) return;
      if (!groups.has(parent)) groups.set(parent, []);
      if (!groups.get(parent).includes(opt)) groups.get(parent).push(opt);
    });

    const questions = [];
    for (const [parent, options] of groups) {
      if (options.length < 3 || options.length > 6) continue;
      // 祖先を遡って空所を含むテキストを持つ最小のコンテナを探す
      let box = parent;
      while (box && !BLANK_RE.test(box.textContent.replace(parent.textContent, ''))) box = box.parentElement;
      if (!box) continue;
      const text = box.textContent.replace(parent.textContent, '').replace(/\s+/g, ' ').trim();
      questions.push({ text, options, labels: options.map((o) => o.textContent.trim()) });
    }
    return questions;
  }

  function askClaude(questions) {
    const apiKey = API_KEY;
    if (!apiKey || apiKey === 'ここにAPIキー') throw new Error('コード上部の API_KEY にキーを貼り付けてください');
    const body = questions.map((q, i) =>
      `Q${i + 1}: ${q.text}\n` + q.labels.map((l, j) => `  ${j}: ${l}`).join('\n')).join('\n\n');
    return new Promise((resolve, reject) => {
      const model = GM_getValue('model', DEFAULT_MODEL);
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        data: JSON.stringify({
          model,
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: '以下は英単語の空所補充問題です。各問の英文の ( ) に入る語を選択肢から選んでください。' +
              '日本語訳が付いている場合は、訳と最も意味が合う語を選ぶこと。' +
              '最後に、選んだ語を選択肢の綴りそのままで、問題順のJSON文字列配列として1行で出力（例: ["sparked","transactions"]）。\n\n' + body,
          }],
        }),
        timeout: 90000,
        onload: (res) => {
          if (res.status !== 200) {
            let msg = res.responseText;
            try { msg = JSON.parse(res.responseText).error.message; } catch (e) { /* 生テキストのまま */ }
            return reject(new Error(`APIエラー(${res.status}): ${msg}`));
          }
          try {
            const text = JSON.parse(res.responseText).content.map((c) => c.text || '').join('');
            const arrs = text.match(/\[[^\[\]]*\]/g);
            resolve(JSON.parse(arrs[arrs.length - 1]));
          } catch (e) { reject(new Error('応答解析失敗: ' + res.responseText)); }
        },
        onerror: (res) => reject(new Error('通信失敗: Tampermonkeyで api.anthropic.com への接続を許可したか確認してください ' + (res && res.error ? res.error : ''))),
        ontimeout: () => reject(new Error('通信タイムアウト')),
      });
    });
  }

  // スクロールで追加読み込みされる問題を全部出すため、ページ末尾まで自動スクロール
  async function loadAll() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const startY = window.scrollY;
    let lastH = -1, same = 0;
    while (same < 3) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(400);
      const h = document.documentElement.scrollHeight;
      same = h === lastH ? same + 1 : 0;
      lastH = h;
    }
    window.scrollTo(0, startY);
  }

  async function run() {
    try {
      toast('問題を読み込み中…');
      await loadAll();
      const qs = extractQuestions();
      if (!qs.length) return toast('問題が見つかりません');
      const answers = await askClaude(qs);
      console.table(qs.map((q, i) => ({ 問題: q.text, 選択肢: q.labels.join(' / '), 回答: answers[i] })));
      let miss = 0;
      qs.forEach((q, i) => {
        // 番号ではなく語で照合（ずれ防止）
        const a = String(answers[i] || '').trim().toLowerCase();
        const opt = q.options[q.labels.findIndex((l) => l.toLowerCase() === a)];
        if (!opt) { miss++; return; }
        opt.style.outline = '3px solid #e53935';
        opt.click();
      });
      toast(`${qs.length}問中 ${qs.length - miss}問を選択` + (miss ? '（一致しない回答あり。F12のConsoleを確認）' : ''));
    } catch (e) {
      toast((e && e.message) || String(e));
    }
  }

  // 画面右下の「解答」ボタン
  const btn = document.createElement('button');
  btn.textContent = '解答';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;' +
    'background:#e53935;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;';
  btn.addEventListener('click', run);
  if (document.body) document.body.appendChild(btn);
  else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));

  // Alt+A でも実行
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'a') run();
  });
})();
