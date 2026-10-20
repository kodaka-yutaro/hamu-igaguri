# ハムとイガグリ

右へ走りつづけるハムスターをタップで跳ねさせて、イガグリをかわすブラウザゲームです。
コースを作って公開し、いいね・コメント・フォローができます。

- 公開先: https://hamu.kdking-tools.com/
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

## Google連携・ログインのセットアップ

ゲストで遊んでいるハムには、あとからメールまたはGoogleを紐づけられます。Googleの設定が済んでいなくても、ゲストプレイとメールによる登録・ログインは利用できます。

### Google Cloud側の設定

1. [Google Auth Platform](https://console.cloud.google.com/auth/overview)で、このサイト用のプロジェクトを選ぶか作成する。
2. Brandingでアプリ名、連絡先、ホームページ `https://hamu.kdking-tools.com/`、プライバシーポリシー `https://hamu.kdking-tools.com/privacy.html` を設定する。Audienceも利用者に合わせて設定する。一般公開するときは、テストユーザーだけがログインできる状態になっていないか確認する。
3. Data Accessで認証に必要な `openid`、`https://www.googleapis.com/auth/userinfo.email`、`https://www.googleapis.com/auth/userinfo.profile` のスコープを設定する。
4. ClientsでOAuthクライアントを作成し、アプリケーションの種類を「ウェブアプリケーション」にする。
5. 次のURLを設定する。

| 設定 | URL |
| --- | --- |
| 承認済みのJavaScript生成元 | `https://hamu.kdking-tools.com` |
| 承認済みのリダイレクトURI | `https://hktjyaqdjboqghbzincb.supabase.co/auth/v1/callback` |

リダイレクトURIは、SupabaseのGoogle provider画面に表示されるCallback URLと一致させます。Supabaseプロジェクトを変更した場合は、このURLも変更してください。

### Supabase側の設定

1. AuthenticationのGoogle providerを開き、Google Cloudで発行したClient IDとClient Secretを設定してGoogleログインを有効にする。
2. Authenticationの設定で、手動のID連携（Manual linking）を有効にする。今のゲストやメール登録済みのハムにGoogleを追加するために必要です。
3. URL ConfigurationのSite URLを `https://hamu.kdking-tools.com/` にし、Redirect URLsにも認証復帰先の `https://hamu.kdking-tools.com/` を許可する。
4. サイトを開き直してマイページを確認する。アプリは公開認証設定の `external.google` を確認し、有効な場合にGoogleのボタンを表示します。設定を取得できない場合やGoogleが無効な場合は、ゲストとメールの入口を使えます。

GoogleのClient SecretはSupabaseの管理画面に保存します。`config.js` やGitHubのソースには入れません。Googleの追加に、Supabaseのservice-roleキーをブラウザへ渡す必要はありません。

### 連携とログインの違い

| 操作 | 動作 |
| --- | --- |
| 今のハムの「Googleで続行」 | `linkIdentity()` で現在のユーザーIDにGoogleを追加する。今のハムの記録・公開コース・プロフィールを引き継ぐ |
| 「登録済みのハムでログイン」内の「Googleでログイン」 | `signInWithOAuth()` で、選んだGoogleアカウントのハムへログインする。別のハムの端末内データを自動で混ぜない |
| このハムにメールを登録 | 現在のユーザーIDにメールアドレスを追加する |
| 登録済みのハムでメールログイン | 届いたメールのリンクから以前のアカウントに戻る |

Googleがすでに別のハムに紐づいている場合、連携から通常ログインへ自動で切り替えたり、ハム同士のデータを自動統合したりしません。以前のハムに戻るときは、利用者が登録済みアカウントへのログインを選びます。

登録済みのハムへ戻るときは、以前このゲームで使ったGoogleアカウントを選びます。初めて使うGoogleアカウントを選ぶと、新しいハムが作られる場合があります。

連携・アカウント切り替えの前に、進行中の保存を待ち、端末にある未同期の記録を保存します。未保存のプロフィール変更がある場合や、記録の保存に失敗した場合は案内を表示します。コースの下書きはユーザーID別に端末のブラウザへ保存され、別の端末には同期されません。

### 引き継ぎの案内

ゲストがエンドレスの自己ベストを更新したとき（初回の記録を除く）と、通常のコースを公開したときに、小さな案内を表示します。同じハムでは24時間に1回までとし、×で閉じた後は7日間表示しません。プレイ領域が小さい場合は結果画面へ表示しません。案内からマイページへ進めますが、登録せずにそのまま遊び続けられます。

### 本番設定後の確認

- ゲストで記録やコースを作り、Google連携の前後でユーザーIDとデータが変わらないこと。
- メール登録済みのハムにもGoogleを追加でき、メールによるログインも引き続き使えること。
- 別のブラウザから同じGoogleアカウントでログインして、同じハムに戻れること。
- 別のハムへ切り替えたときに、前のハムの記録・着せかえ・コースの下書きが混ざらないこと。
- Googleの画面でキャンセルした場合や、すでに使用中のGoogleへの連携が失敗した場合に、今のハムで遊び続けられること。
- スマホの通常ブラウザとホーム画面から開く場合の両方で、認証からゲームへ戻れること。

Google providerが有効という設定だけでは、Google CloudのURL設定や手動のID連携まで正常に動くとは限りません。外部設定後は上の実際の認証を確認してください。

### 開発時の確認

Node.jsで、外部通信を行わない認証・端末データ・引き継ぎ案内のテストを実行できます。

```sh
node tests/auth.test.cjs
node tests/storage.test.cjs
node tests/account.test.cjs
```

参考: [Supabase: Sign in with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)、[Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)、[Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)、[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
