#!/bin/bash
# Mac 用: ダブルクリックでダウンロード(初回のみ)→サーバー起動→ブラウザを開く
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が必要です。https://nodejs.org/ja から LTS 版を入れてから、もう一度ダブルクリックしてください。"
  read -r -n 1 -p "何かキーを押すと閉じます"
  exit 1
fi
node download.mjs && node serve.mjs --open
