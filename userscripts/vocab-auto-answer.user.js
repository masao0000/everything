// ==UserScript==
// @name         Vocab Auto Answer
// @namespace    https://github.com/masao0000/everything
// @version      1.4.0
// @description  英語の空所補充4択問題を読み取り、Claude APIで正解を判定して自動選択する
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.anthropic.com
// ==/UserScript==

(function () {
  'use strict';

  // ↓ここにClaude APIキー(sk-ant-...)を直接貼り付け (https://console.anthropic.com で発行)
  const API_KEY = 'ここにAPIキー';
  const DEFAULT_MODEL = 'claude-haiku-4-5';
  const BLANK_RE = /\(\s*\)|（\s*）|_{2,}/;

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
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: '以下の英語空所補充問題それぞれについて、正しい選択肢の番号(0始まり)を答えてください。' +
              '和訳がある場合はそれも参考に。JSON配列のみで出力（例: [3,1,0]）。\n\n' + body,
          }],
        }),
        onload: (res) => {
          try {
            const text = JSON.parse(res.responseText).content.map((c) => c.text || '').join('');
            resolve(JSON.parse(text.match(/\[[\d,\s]*\]/)[0]));
          } catch (e) { reject(new Error('応答解析失敗: ' + res.responseText)); }
        },
        onerror: reject,
      });
    });
  }

  async function run() {
    try {
      const qs = extractQuestions();
      if (!qs.length) return alert('問題が見つかりません');
      const answers = await askClaude(qs);
      qs.forEach((q, i) => {
        const opt = q.options[answers[i]];
        if (!opt) return;
        opt.style.outline = '3px solid #e53935';
        opt.click();
      });
    } catch (e) {
      alert(e.message);
    }
  }

  // 画面右下の「解答」ボタン
  const btn = document.createElement('button');
  btn.textContent = '解答';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;' +
    'background:#e53935;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;';
  btn.addEventListener('click', run);
  document.body.appendChild(btn);

  // Alt+A でも実行
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'a') run();
  });
})();
