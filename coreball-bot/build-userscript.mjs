// inject.js からユーザースクリプト (Tampermonkey 用) を生成する: node build-userscript.mjs
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(new URL("./inject.js", import.meta.url), "utf8");
const header = `// ==UserScript==
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
`;
// 日本語などの非 ASCII 文字は \\uXXXX に置き換える。メモ帳などで文字コードを誤認されても壊れないようにするため。
const ascii = (header + src).replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
writeFileSync(new URL("./coreball-bot.user.js", import.meta.url), ascii);
console.log("coreball-bot.user.js を生成しました");
