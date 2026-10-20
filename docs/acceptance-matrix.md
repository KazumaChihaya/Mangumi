# 仕様・実装・受入の対応表

2026-10-20。対象は `product-specification.md` の Phase 1〜6 とサイトマップ204項目。画面数の確認だけで業務機能の完成とは判定しません。試験は合成会員・隔離DBで実施し、外部事業者の実取引や実端末試験とは区別します。

| 領域 | 主な実装ファイル | 自動確認 | 配置後の受入 |
| --- | --- | --- | --- |
| 全画面・演出 | memberのScreen、cabinet/jackpot.css。利用者109・管理95、ネオン、演出と音、画像比率と9スライス枠 | 全204画面、320pxとPC、横はみ出し、操作 | 実端末の文字サイズ・読み上げ・音量・動きの設定 |
| 会員・認証 | auth、auth-security、members。登録・規約、メール確認/変更、パスワード、端末、退会・開示・訂正 | 一回限りリンク、改ざん・失効、別端末警告、端末解除 | 実ドメインの到達性とSPF/DKIM/DMARC |
| 管理者 | Cookie分離、MFA、復旧コード、ロール、IP/CIDR、有効時間、監査 | 権限なし拒否、実ブラウザMFA、監査比較 | 認証アプリ・復旧コード保管 |
| プラン・権限 | domain、limits、content-access。日週月・同時数・容量・秒数・対象・上書き・予約変更 | API制限、再送、非公開プランの既存会員、閲覧前の本文/画像制限 | 運営による各料金・権限・上限の設定 |
| 予定 | domain、reminders、管理Content。月/週/一覧、繰り返しの各回、TZ、予約・変更・中止 | 別ブラウザ反映、UTC/DST、個別設定の保存 | 実際の配信リンクと端末TZ |
| リマインダー | 管理の既定・配信ごとの最大5時刻・停止、利用者ごとのON/OFF | カスタム5分前、個別OFF、停止後の未送信、二重防止 | 端末スリープ・通知時刻 |
| PWA / Web Push | jobs、notifications、install-guides、LivePwa、SW。ボタン操作による許可、OS別画像、更新・オフライン | 静音時間、購読失効、対象・予約取消、Pagesスコープ | iPhoneホーム画面追加、ブラウザ許可、実VAPID |
| ストーリー | domain、social、LiveStories/Content。画像・動画、予約、失効、ハイライト、リンク、プラン、既読集計 | 私有メディア、公開時刻、閲覧制限、管理画面の編集 | 実端末の動画形式・回線 |
| DM | social、media、LiveDM。公式と会員の1対1、録音・試聴、音声検査、未読、ミュート、撤回・削除 | 2会員間のテキスト/録音、所有権、再送、相互ブロック、証跡 | マイク権限・実端末での音声 |
| 音声ルーム | social、LiveVoice、NativeVoice。予約・招待、共同ホスト、登壇、ミュート、退出、BAN、反応、人数・時間・品質 | 実LiveKitと2ブラウザの音声、登壇・降壇・BAN、自己昇格拒否 | 別回線/TURN、バックグラウンド、ホスト切断、実人数負荷 |
| Web課金・応援 | checkout、billing、tipping、tip-messages。整数金額・期間上限、公開範囲、署名Webhook、解約・返金 | 二重防止、Webhook前は保留、返金・手数料・ロール、私信保護 | Stripeで実際の3DS・返金・チャージバック |
| iOS/Android課金 | stores、store-provider、native/billing。ストア価格、サーバー検証、所有者、商品スナップショット、復元・更新・失効・返金 | 検証アダプターの試験で二重付与・他会員・期限・返金取消・順序逆転、未設定/偽造拒否 | 実Sandbox、署名チェーン、RTDN/OIDC、承認待ち、更新・復元・返金 |
| 売上 | reports、LiveRevenue。期間・受取人・返金・手数料・CSV、ストアとコイン消費を別表示 | 署名イベント集計、未知手数料は未確定、ロール | Store精算書の照合、配信者送金は仕様どおり外部経理 |
| ガチャ | domain、campaigns、gacha-versions。暗号学的乱数、無料チケット、複数回、在庫、固定版、写真/音声/透過フレーム | 確率合計、二重消費、不足時ロールバック、版固定、獲得者限定ファイル、フレーム適用 | 景品の権利・規約・条件の確定 |
| ブランド | operations、LiveBrand。画像検証・生成、色、名称、各ロゴ、OGP、規約、予約公開・復元 | HTML/メールのエスケープ、比率、予約 | 本物の素材と連絡先。同梱アイコン変更は再ビルド |
| 通報・安全対策 | social、members。証跡、担当・状態、警告/停止/非表示、NG語、URL・連投・ファイル検査 | 証跡、停止と失効、相互ブロック | 運営の対応期限・問い合わせ・利用条件 |
| 運用 | MariaDB/SQLite、jobs、monitoring、retention、backup。永続化・監視・アラート・保存期間・暗号化復旧 | 再起動、暗号化/改ざん拒否/復元、証拠保持、負荷 | Sakura VPS、DNS/TLS、別障害領域の保管、RPO/RTO、外部死活監視 |
| ネイティブ | apps/native。同じ全画面UI、OS SecureStore、Expo/APNs/FCM、LiveKit/Android FGS、録音、アプリリンク | 型検査、認証・遷移5試験、両OS JS export、ActionsでAndroid/iOSコンパイル | 実機、署名済み配布、TestFlight/Play内部テスト、審査 |

## 再現と試験の境界

* `pnpm typecheck`、`pnpm typecheck:api`、`pnpm --filter @mangumi/native typecheck`。
* `pnpm test:api`：41件。SQLiteと127.0.0.1の隔離MariaDB `mangumi_test` で実施。
* `pnpm test:native`：5件。WebViewへの認証情報漏えい防止、更新の単一化、Origin、連携の競合、遷移。
* `pnpm test`：モデル5件。`pnpm test:security`：依存修正4件。
* `pnpm build:live` → 隔離SFUの `MANGUMI_TEST_LIVEKIT_URL` を指定して `pnpm test:live`。
* `pnpm build` → `pnpm test:e2e`。`pnpm build:pages` → `pnpm test:pages`。
* `pnpm build:native` と `.github/workflows/native.yml`。端末コンパイルの成否は [Actions](https://github.com/KazumaChihaya/Mangumi/actions) の対象コミットで確認。
* `pnpm test:load`：合成会員200人、予定30件、通常API200要求、同時8。ローカルMariaDBのp95約158ms。実VPSの最大人数を保証する試験ではない。
* `pnpm audit --json` と `scripts/check-audit.mjs`。上流勧告2件をローカル修正と回帰試験で追跡し、監査0件とは扱わない。

閲覧上限は「未閲覧コンテンツを初めて開く回数」。一覧取得・再読込・取得済みの再閲覧を重複消費しません。対象にはコンテンツID・配信者ID、カレンダーでは登録された配信者名も指定できます。Storeの業務試験は検証アダプターによるもので、Apple/Googleの実取引が合格したことを意味しません。

## 未実施の受入と初期無効の機能

VPS・ドメインが未取得のため本番接続は未実施。SMTP/Stripe/LiveKitの本番設定、Apple/Google/Expoの所有者アカウント、実端末、ストア商品と資格情報が必要です。[Sakura配置](sakura-deployment.md)と[ネイティブ接続](native-deployment.md)に手順をまとめています。

仕様で初期無効または将来別要件の、一般会員同士のDM、ルーム録音・公開アーカイブ、有料ガチャ、換金・譲渡・自動送金、文字起こし、任意の天井・コンプ報酬は提供しません。iOS／Android自体は今回の実装対象に含めています。事業者資格情報の接続、実端末、運用条件、ストア審査合格はコード実装済みとは別の受入です。
