# マイニュース

開いた瞬間に最新ニュースを取得する個人用ニュースアプリ。

- **あなた向け**: Yahoo!ニュースの記事を 👍👎 の学習結果で並べ替え（20件）
- **実生活**: お金・経済／健康・医療／制度・ルールの変化（好みは反映しない・20件）
- 要約カード: 各記事ページの説明文
- 同期: 設定⚙で合言葉を入れると 👍👎 がスマホとPCで同期

## 公開手順（Vercel）
1. https://vercel.com に GitHub でログイン → **Add New → Project** → このリポジトリを Import → Deploy
2. プロジェクトの **Storage** → **Upstash (Redis)** を追加して Connect（環境変数が自動設定される）→ Redeploy
3. `https://<プロジェクト名>.vercel.app/news/` を開く

## 構成
- `api/news.js` ニュース取得（2分キャッシュ）
- `api/prefs.js` 学習結果の同期（Upstash Redis）
- `news/index.html` 画面
