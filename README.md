# ハムとイガグリ

右へ走りつづけるハムスターをタップで跳ねさせて、イガグリをかわすブラウザゲームです。
コースを作って公開し、いいね・コメント・フォローができます。

- 公開先: https://kodaka-yutaro.github.io/hamu-igaguri/
- `main` に push すると GitHub Actions で GitHub Pages に公開されます。

## ファイル

| ファイル | 中身 |
| --- | --- |
| `index.html` | ゲーム・コースエディタ・SNS画面のすべて |
| `backend.js` | Supabase とのやりとり（コース・プロフィール・掲示板の保存とリアルタイム更新） |
| `config.js` | Supabase の Project URL と anon キー（公開してよい値） |
| `supabase/schema.sql` | データベースの作成と、誰が何を書けるかのルール |

## オンライン機能のセットアップ

1. Supabase でプロジェクトを作る。
2. SQL Editor で `supabase/schema.sql` を実行する。
3. Authentication → Sign In / Providers で「Allow anonymous sign-ins」をオンにする（登録なしでゲスト参加できるようにするため）。
4. Authentication → URL Configuration の Site URL に公開先 URL を入れる（メール登録のリンク先）。
5. `config.js` に Project URL と anon キーを書いて push する。
6. サイトのマイページに出るユーザーIDで、運営を登録する:
   `insert into public.admins (user_id) values ('<ユーザーID>');`

`config.js` が空のままでも、ゲームとコース作りはオフラインで遊べます。
