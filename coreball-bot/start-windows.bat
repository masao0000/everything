@echo off
chcp 65001 > nul
cd /d "%~dp0"
title まち針ゲーム 自動プレイ

where node > nul 2>&1
if errorlevel 1 (
  echo Node.js が入っていません。開いたページから「LTS」をダウンロードしてインストールし、
  echo もう一度このファイルをダブルクリックしてください。
  start https://nodejs.org/ja
  pause
  exit /b
)

if not exist node_modules\playwright (
  echo 初回の準備中です（数分かかります）...
  call npm install || goto :err
)
rem ブラウザの用意（済んでいれば一瞬で終わる。失敗しても Edge で動く）
call npx playwright install chromium

node bot.mjs --levels 500
pause
exit /b

:err
echo 準備に失敗しました。上のメッセージを確認してください。
pause
