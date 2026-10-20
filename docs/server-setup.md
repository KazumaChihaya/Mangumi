# サーバー実装と配置

## 2つのビルド

| ビルド             | 用途                                   | データ                                |
| ------------------ | -------------------------------------- | ------------------------------------- |
| `pnpm build:pages` | GitHub Pagesで見た目・演出・画面を確認 | ブラウザ内のサンプル                  |
| `pnpm build:live`  | APIと同じHTTPSドメインからPWAを配信    | SQLite／MariaDB、サーバー内のファイル |

Pagesは静的ホスティングのため、API・DB・メール・決済ジョブを実行できない。本番はAPI接続版をVPSへ配置する。ARROWの認証情報・DB・アカウントは使用しない。今回、画像素材・筐体フレームの縦横比を変える変更はしていない。

## 開発で起動

Node.js 24、pnpm 11.25を使用する。

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm build:live
pnpm start:live
```

起動先は `http://localhost:3001`。APIの作業ディレクトリを基準に、SQLiteは `.local/mangumi.sqlite`、ファイルは `.local/uploads`、メール出力は `.local/outbox`。開発用の暗号鍵は `.local/encryption-key` に一度だけ作り、再起動時に再利用する。`.local` と `.env*` はGit・Dockerビルドから除外している。

登録は本人のプロフィール写真をアップロードして行う。メール確認用のリンクは開発時にoutboxのJSONへ出力する。本番でSMTPが未設定の場合、メール送信はエラーになり、運営側で設定とジョブの再試行が必要になる。

### 初期管理者

`.env` の `BOOTSTRAP_ADMIN_EMAIL` と `BOOTSTRAP_ADMIN_PASSWORD` を設定し、次を実行する。公開用の固定パスワード・テストアカウントは存在しない。

```powershell
pnpm --filter @mangumi/api admin:create
```

作成後、bootstrap用の変数を消す。`/admin/A001` からログインし、認証アプリへTOTPのキーを登録する。復旧コードを安全な場所へ保管する。管理者Cookieは会員Cookieと分離し、APIは各操作でロールを判定する。

認証アプリと復旧コードを失った場合は、サーバーの管理者が本人確認を行った上で `RECOVERY_ADMIN_EMAIL` と10文字以上の `RECOVERY_REASON` を設定し、`pnpm --filter @mangumi/api exec tsx src/cli.ts mfa-reset` を実行する。全セッションを失効させ、操作を監査に記録する。

## 本番へ配置

さくらVPSを使用する場合は [さくらVPSへの配置](sakura-deployment.md) に、DNS・通信ポート・Docker・鍵生成・初期管理者・更新の手順をまとめている。

1. アプリ用のドメイン、VPS、トランザクションメール、Stripe、音声基盤を用意する。
2. `.env.example` を元にVPS上で `.env` を作る。
3. `pnpm --filter @mangumi/api keys` で、暗号鍵、VAPID、URLに使用できるDBパスワードを `.env.keys.generated` へ生成する。値はコンソールに表示しない。必要な値を `.env` へ移し、暗号鍵を別の安全な場所にも保管する。
4. `APP_DOMAIN`、SMTP、差出人、VAPID_SUBJECT、Stripe、LiveKitを設定する。`ENCRYPTION_KEY` は再配置時にも維持する。
5. `infra/production` で `docker compose --env-file ../../.env up -d --build` を実行する。CaddyがHTTPS、APIがPWAとREST、MariaDBが非公開ネットワークのDBを担当する。
6. `docker compose --env-file ../../.env exec api node --import tsx src/cli.ts admin` で初期管理者を作り、二要素認証を登録する。
7. ブランド画面で運営者の規約・プライバシーポリシー・問い合わせ先を公開する。本番の会員登録はこれらが設定されるまで受け付けない。
8. SMTP配送、実端末のPWAとPush、別ネットワークの音声、Stripeテスト環境の決済・解約・返金を確認してから一般公開する。

API・DBのポートはホストに公開せず、Caddyだけ80/443を公開する。管理画面は二要素認証に加え、運用設定から許可IP／CIDRを設定できる。現在の接続元が含まれない設定は保存を拒否する。VPSとバックアップ先のディスク暗号化はホスト側で設定する。暗号鍵の紛失時は管理者のTOTPを復号できない。

### 外部サービス

| サービス | 設定                                         | 確認                                                 |
| -------- | -------------------------------------------- | ---------------------------------------------------- |
| メール   | SMTP_URL、MAIL_FROM                          | 確認・再送・再設定・招待メールが届くこと             |
| Web Push | VAPIDの公開鍵／秘密鍵／連絡先                | iOSのホーム画面アプリとAndroidで購読、配信、クリック |
| Stripe   | SECRET_KEY、WEBHOOK_SECRET、プランのPrice ID | `/api/webhooks/stripe` の署名検証、金額・顧客の照合  |
| 音声     | LIVEKIT_URL／API_KEY／API_SECRET             | `/api/webhooks/livekit`、TLS、TURN、異なる回線       |

Stripeの対象イベントは `payment_intent.succeeded`、`payment_intent.payment_failed`、`payment_intent.canceled`、`checkout.session.completed`、`checkout.session.expired`、`customer.subscription.*`、`charge.succeeded`、`charge.updated`、`charge.refunded`、`invoice.paid`、`refund.updated`、`refund.failed`、`charge.dispute.created`、`charge.dispute.closed`。クライアントの戻りURLだけでは決済成功・プラン付与を確定しない。

音声ホストの切断検知には署名付きLiveKit Webhookが必要。録音は無効。別VPSまたはLiveKit Cloudを使用する。[音声基盤の設定](../infra/livekit/README.md)も参照する。

## バックアップと復旧

`infra/production/backup.sh` はDBのダンプとアップロードをまとめ、ageの公開鍵で暗号化する。ageとDockerが使えるLinuxホストで、別ディスクまたは別ホストのマウント先を `BACKUP_DIR`、復号先の公開鍵を `BACKUP_RECIPIENT` に設定して実行する。秘密鍵とENCRYPTION_KEYは別に保管する。稼働中のアップロードとDBを同時点にする厳密なスナップショットではないため、復旧点を揃えるバックアップはメンテナンス時間中に行う。

復旧は本番を上書きせず、隔離環境で行う。

1. ageでバックアップを復号し、DBダンプとファイルを展開する。
2. 空のMariaDBへ `database.sql` をインポートする。
3. 空のアップロードボリュームへ `uploads.tar.gz` を展開し、API実行ユーザーが読める所有権にする。
4. 元のENCRYPTION_KEY、環境変数、同じアプリのリビジョンでAPIを起動する。
5. ログイン、管理者MFA、画像、DM、抽選履歴、通知ジョブを確認する。

実運用のバックアップ先、保持期間、RPO／RTOと復旧訓練は未確定。バックアップの復号・復元を実環境で確認するまで、復旧保証済みと扱わない。

## 実装範囲と接続時の確認

Web／PWA（Phase 1〜5）の利用者画面と管理画面、および Phase 6 の iOS／Android ホスト・通知・音声・ストア課金アダプターを実装している。[仕様・試験対応表](acceptance-matrix.md)で検証範囲、[ネイティブ配置](native-deployment.md)でストア接続を確認する。実機受入・本番接続・ストア審査は未完了。

| 分野 | 実装した処理 |
| --- | --- |
| 認証・会員 | 写真付き登録、規約版、メール確認・再送・変更・再設定、Argon2id、端末失効、退会、MFAと復旧、5管理ロール、予約プラン変更、期限付き停止、開示・訂正・削除対応 |
| PWA・ブランド | オフライン画面、更新ボタン、通知購読、端末・ブラウザ・OSバージョン別の画像付き案内、案内の公開順と最終確認日、ロゴ・色・通知アイコン・OGP・HTMLメール、予約公開・復元 |
| 配信・ストーリー | 予定CRUDと繰り返し、UTC保存と端末時刻表示、夏時間検証、予約公開、変更通知、対象プラン、期限・ハイライト、画像・短い動画・リンク、既読・閲覧者数 |
| 通知 | テンプレート、属性・プラン・許可状態・最終利用・個別会員の抽出と事前確認、本人へのテスト送信、即時・予約・取消、小分けジョブ、再試行、失敗理由・クリック、種別設定・サイレント時間・ミュート・ブロック |
| DM | 公式との1対1、文字・録音・再生、既読・取消・自分から非表示、許可URL、ブロック・通報・証拠保全・署名付き音声、履歴追加読込、自動削除 |
| 音声 | LiveKit実音声、公式の作成と予約開始、公開・プラン・招待限定、人数・最大時間、登壇・共同ホスト・ミュート・退出・BAN・リアクション、再接続とミニプレイヤー、品質診断。録音は初期仕様の無効を維持 |
| プラン | Free保護、登録済み機能キー、表示名・説明、権限レベル、日・週・月の利用回数、対象ID、同時参加・作成数、音声容量・秒数・保存日数、期限付き個別権限、月額・年額・体験・申込期間・解約方針 |
| 決済 | Stripe Hosted Checkout、カード登録、月・年契約、Webhookによる確定、本人の解約、金額候補・最低額・日月上限、MFA付き返金、異議申立て、期間・受取人別売上CSV、取得済み手数料と未確定件数。遅いCheckout応答中もDBの業務ロックを保持しない |
| ガチャ | サーバー乱数、0.01%単位の割合、確率版の予約・取消・履歴、並行キャンペーンと固定確率版、在庫・原子的消費・再送防止、補填、獲得者用ファイル、日次配布、フレーム装着・解除 |
| 運用 | 検索・並替・ページング・CSV、監査の変更前後比較、保存期間のプレビュー・証拠保持・ファイル削除、失敗ジョブ再試行、API p95・DB・音声品質監視、暗号化バックアップと空環境への復元、OpenAPIと型付きクライアント生成 |

本番接続にはMangumi専用のVPS・ドメイン、SMTP・VAPID・Stripe・LiveKitの設定が必要。実際の事業者アカウント、運営者の規約・年齢方針、iPhone／Androidの実機、別回線のTURN、運用するバックアップ先と保持期間・RPO／RTOを接続時に確認する。ARROWの環境は使用しない。

### 保存期間

`/admin/A085` で方針・削除対象・処理履歴を確認する。初期状態は自動削除OFF。ONにすると1時間ごとに処理し、手動実行も確認入力が必要。調査中・保持中の通報、景品とコレクション、決済・監査の参照を保持する。ファイル削除はDBで参照を外してから永続キューで実行し、プロセス停止後も再開する。

### 暗号化バックアップの実装と復旧訓練

外部コマンドを要しないAES-256-GCMのストリーム形式も使用できる。`BACKUP_KEY` は32バイトのbase64で、`keys` コマンドで生成する。バックアップと別の場所へ保管する。

```powershell
$env:BACKUP_KEY = '<サーバーの秘密情報から設定>'
$env:BACKUP_FILE = '<バックアップ先の絶対パス>.mgbak'
pnpm --filter @mangumi/api exec tsx src/cli.ts backup
```

作成前に管理画面でメンテナンスを有効にする。DBと参照ファイルを同じトランザクション内で読み出し、既存の出力ファイルを上書きしない。Dockerでは `node --import tsx src/cli.ts backup` を使う。

復元では `RESTORE_DATABASE_URL` に `mangumi_restore_` で始まる新しいDB名、または `RESTORE_SQLITE_PATH` に新しいSQLiteを指定し、`RESTORE_UPLOAD_DIR` に別のファイル領域を指定して `src/cli.ts restore` を実行する。既存レコード・同名ファイルへの上書きは拒否する。認証タグを検証してからコミットし、失敗時にはDBをロールバックする。

自動試験でDB・画像の暗号化と復元、改ざん拒否、部分データを残さないことを確認する。本番の別障害領域への保管・実回線での復旧時間は、配置先で測定する。

### 運用アラート

`/admin/A089` で通知先（最大5件）・API p95・エラー率・最小サンプル数・失敗ジョブ数・継続通知間隔を設定する。初期は無効。直近5分のAPIサンプル（ルートごとに最大500件）を1分ごとに判定し、異常・回復を永続メールジョブへ登録する。SMTPの失敗はジョブの再試行対象になる。アプリが停止した状態は自身では検知できないため、別ホストの死活監視からHTTPSの `/api/health` と `/api/readiness` を監視し、通知先へ接続する。readinessは設定の有無を示し、SMTP等への実送信試験の代わりにはならない。

## 検証

`pnpm typecheck`、`pnpm typecheck:api`、`pnpm test`、`pnpm test:security`、`pnpm test:api`、`pnpm test:load`、`pnpm build:live`、`pnpm test:live` を使用する。

API試験は隔離SQLite、MariaDB試験は127.0.0.1の **mangumi_test** のみを対象にする。ブラウザ試験は合成会員・ローカルメール受け皿を使用する。`MANGUMI_TEST_LIVEKIT_URL` の指定時は2ブラウザで実際の音声と登壇・降壇・BANを確認する。

負荷試験の条件は、合成会員200人・配信予定30件・通常画面API200リクエスト・同時8件。ローカル実測のp95はSQLite約15ms、MariaDB約159msで500ms未満。配置先のCPU・回線・同時利用数に対する保証値ではない。

`pnpm generate:client` は `docs/openapi.json` と `apps/member/src/generated/api-client.ts` を更新する。リクエスト形、共通エラー、主要レスポンス、Cookie・CSRF・再送キーを記述し、CIで生成結果との差分を検査する。可変の管理データは拡張可能なオブジェクトとして定義する。

依存ライブラリの修正・回帰試験・上流勧告が残る2件の扱いは [セキュリティ修正](security-patches.md) を参照する。監査結果を無条件に無視しない。
