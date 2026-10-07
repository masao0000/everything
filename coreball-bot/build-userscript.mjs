// inject.js からユーザースクリプト (Tampermonkey 用) を生成する: node build-userscript.mjs
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(new URL("./inject.js", import.meta.url), "utf8");
const header = `// ==UserScript==
// @name         まち針ゲーム 自動プレイ
// @namespace    coreball-bot
// @version      1.0
// @description  arealme.com のまち針ゲームを自動で進めます。右上のボタンか A キーで ON/OFF
// @match        https://www.arealme.com/coreball/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// このファイルは build-userscript.mjs で inject.js から生成しています。

window.__cbStandalone = true;
`;
writeFileSync(new URL("./coreball-bot.user.js", import.meta.url), header + src);
console.log("coreball-bot.user.js を生成しました");
