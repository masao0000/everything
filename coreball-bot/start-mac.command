#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が入っていません。開いたページから「LTS」をダウンロードしてインストールし、"
  echo "もう一度このファイルをダブルクリックしてください。"
  open https://nodejs.org/ja
  read -p "Enter キーで閉じます"
  exit 1
fi

if [ ! -d node_modules/playwright ]; then
  echo "初回の準備中です（数分かかります）..."
  npm install || { read -p "準備に失敗しました。Enter キーで閉じます"; exit 1; }
fi
# ブラウザの用意（済んでいれば一瞬で終わる。失敗しても Chrome で動く）
npx playwright install chromium

node bot.mjs --levels 500
read -p "終了しました。Enter キーで閉じます"
