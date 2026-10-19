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

Stripeの対象イベントは `payment_intent.succeeded`、`payment_intent.payment_failed`、`payment_intent.canceled`、`checkout.session.completed`、`checkout.session.expired`、`customer.subscription.*`、`charge.refunded`、`refund.updated`、`refund.failed`、`charge.dispute.created`、`charge.dispute.closed`。クライアントの戻りURLだけでは決済成功・プラン付与を確定しない。

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

## 実装範囲と残作業

| 分野             | 実装した主要処理                                                                                                                        | 残る設定・拡張・検証                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 認証             | 写真付き登録、規約版、Argon2id、確認・再送・メール変更・再設定、端末失効、退会                                                          | 本番SMTP、事業者の規約・年齢方針、実機                                 |
| 管理             | MFA・復旧コード、5ロール、理由付き監査、会員検索・ページング、予約プラン変更、期限付き停止、開示と対応記録                              | 組織の本人確認・削除運用、監査の別保管                                 |
| PWA              | 初回端末別案内、Manifest・アイコン、オフライン画面、更新ボタン、通知購読                                                                | iPhone／Android実機、インストール更新の受入                            |
| 配信・ストーリー | 予定CRUD、繰り返し作成、変更通知、公開時刻、対象プラン、24時間期限・ハイライト、画像／短い動画、既読                                    | 端末タイムゾーンの完全対応、高度な検索・集計                           |
| 通知             | DBキュー、原子的取得、再試行、無効購読削除、サイレント時間、ミュート・ブロック、予約、クリック                                          | 実配送、テンプレートUI・高度な対象抽出、事業者障害時の重複評価         |
| DM               | 会員と公式の1対1、文字、録音アップロードと再生、既読、取消、ブロック、証拠付き通報、署名付き音声、履歴の追加読込                        | 保存期間に沿った自動消去                                               |
| 音声             | 公式作成・予約開始、実音声、登壇、マイク制御、共同ホスト、退出・BAN、リアクション、ホスト不在終了                                       | TURN・回線切替・負荷・切断復旧の実環境試験                             |
| 決済             | Hosted Checkout、カード登録、月／年額・体験、Webhook確定、契約管理、投げ銭、MFA付き返金、CSV、異議申立て状態                            | Stripe実契約、会計上の手数料・期間別分析、運用確定                     |
| ガチャ           | サーバー乱数、0.01%単位の割合、確率版、在庫、原子的消費、履歴・補填・獲得ファイル、日次配布、対象プラン・費用・上限、フレーム装着・解除 | 高度なキャンペーン・予定版、提供条件の確定                             |
| プラン           | Free保護、機能のAPI判定、DM／抽選の日次上限、音声秒数、期限付き個別権限                                                                 | 仕様書の汎用的な週次・月次・対象者別の全上限設定                       |
| ブランド         | ロゴ・アイコン・OGP・メール用素材・案内画像、公開・予約・復元、法定リンク                                                               | メール用素材のHTML適用、各OSキャッシュの確認                           |
| 配置             | Docker、Caddy、MariaDB、暗号化バックアップの実行スクリプト、OpenAPIのルート・主要モデル                                                 | 本番配置、全APIの詳細なOpenAPI・生成SDK、負荷・復旧訓練                |
| iOS／Android     | 共通モデルとAPI境界                                                                                                                     | Phase 6のネイティブ描画、StoreKit／Play Billing、APNs／FCM、ストア審査 |

全ページの表示テストと、全機能の本番受入は別の確認事項。上表の残作業があるため「全機能の本番運用が完成した」状態とは扱わない。管理画面の保存期間は現在設定値として保存し、自動消去はまだ実行しない。退会・削除対応ではログインとプロフィールを無効化し、監査・決済・通報・DMの保持は運営の確定した方針に基づき別途処理する。

## 検証

`pnpm typecheck`、`pnpm typecheck:api`、`pnpm test`、`pnpm test:api`、`pnpm build:live`、`pnpm test:live` を実行する。APIテストは既定で隔離SQLiteを使用する。MariaDBの試験は、127.0.0.1の **mangumi_test** だけを対象に `MANGUMI_TEST_DATABASE_URL` を設定する。テストはこのDBの既知のテーブルを初期化する。

ブラウザ試験は合成アカウント・ローカルメール受け皿を専用プロセスで作り、会員登録、別アカウントへの反映、権限、DM録音、全204項目を確認する。本番アカウント・本番決済には接続しない。`MANGUMI_TEST_LIVEKIT_URL` を設定すると、実LiveKitを使った2ブラウザの音声と登壇・降壇・BANを検証する。CIはこの音声試験も実行する。

`pnpm --filter @mangumi/api openapi` は `docs/openapi.json` を更新する。実行時の `/api/openapi.json` からも確認できる。

依存監査では、Expo側の依存に [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq)、[decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)、[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv)、[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) の4件が残る。本番APIコンテナからこれらのビルド用依存は除外したが、公開Webバンドルも含めた修正・影響確認は本番受入前の残作業。修正版がESMへ変更される依存もあるため、互換性を確認せずに一括上書きしない。
