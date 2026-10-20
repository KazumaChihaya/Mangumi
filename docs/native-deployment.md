# iOS / Android 配布と接続

`apps/native` は Expo / React Native の専用アプリです。会員・管理画面は既存 Web UI を HTTPS の WebView で共有し、パチスロ風の画像、フレームの縦横比、演出、効果音を共通にします。音声ルーム、バックグラウンド音声、録音、通知、端末の安全な認証情報保存、ストア購入はネイティブ SDK で処理します。WebView にアクセストークンや更新トークンは渡しません。

## 開発・コンパイル

1. ルートで `pnpm install --frozen-lockfile`。
2. `apps/native/.env.example` を同ディレクトリの `.env` にコピー。APP_ORIGIN は API と画面を同居させる HTTPS オリジン。Pages は API がないため本アプリの接続先には使用できません。
3. `pnpm --filter @mangumi/native dev`。Expo Go ではなく development build を利用します。
4. `pnpm --filter @mangumi/native exec expo prebuild --platform android` と `expo run:android`、Mac では `expo prebuild --platform ios` と `expo run:ios`。
5. `pnpm test:native`、`pnpm --filter @mangumi/native typecheck`、`pnpm build:native`。JS export は端末バイナリのコンパイルとは別の検証です。

GitHub Actions の「Verify native applications」で Android APK と署名なし iOS Simulator アプリをコンパイルし、7日間の成果物として保存します。これらはストア提出用の署名済みリリースではありません。端末で HTTPS、通知、録音、バックグラウンド移行、再接続を検証してください。

EAS 利用時は自身の Expo プロジェクト ID、Apple/Google の固有 bundle/package ID、接続先を設定してから `eas build --profile production --platform all`。production プロファイルは未設定の ID・HTTPS 接続先を拒否します。`eas.json` に秘密情報は含めません。通知資格情報、署名、App Store Connect / Play Console への提出は所有者のアカウントで設定します。

## 通知・アプリリンク

APNs / FCM の資格情報を EAS プロジェクトへ登録します。利用者が説明を読み「通知をONにする」を選んだ後だけ OS 許可を要求します。Expo Push のアクセス保護を有効にし、サーバー側 `EXPO_ACCESS_TOKEN` を設定してください。配送票を保存し、後続 receipt のエラーを取り込み、失効端末を削除します。

`APPLE_TEAM_ID` / `APPLE_BUNDLE_ID` と `GOOGLE_PLAY_PACKAGE` / `ANDROID_CERT_SHA256` を設定すると API は `/.well-known/apple-app-site-association` と `/.well-known/assetlinks.json` を配信します。実機で署名と HTTPS ドメインの関連付けを確認します。

## ストア決済

* Apple: `APPLE_BUNDLE_ID`、数値 `APPLE_APP_ID`、`APPLE_ENVIRONMENT`（Sandbox / Production）、`APPLE_ROOT_CERTIFICATES` を設定。信頼済み Apple ルート証明書を Apple PKI から取得・確認し、`.secrets` 以下に配置。コンテナでは `/run/secrets/` のパスを指定します。ライブラリは証明書チェーン、署名、環境、bundle、App ID を検証します。
* Google: Play Developer API を有効化した専用サービスアカウントに対象アプリの購入読み取り権限を付与。JSON を `.secrets/google-play.json` に配置し、`GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-play.json`。Node 実行 UID 1000 が読める所有権にします。JSON は Git、ブラウザ、チャットへ出しません。
* App Store Server Notifications V2: `https://<domain>/api/webhooks/apple`。Google RTDN: `https://<domain>/api/webhooks/google-play`。Pub/Sub Push の OIDC audience とサービスアカウント email を `GOOGLE_NOTIFICATION_AUDIENCE` / `GOOGLE_NOTIFICATION_EMAIL` に設定し、認証付き配送を使用。
* 管理画面「プラン」にプラットフォーム別の商品 ID を登録。月額・年額は別 SKU とし、プランへ対応付けます。消費型の応援コインはガチャの無料チケットとは独立しています。ストアが返す現地価格を支払い前に表示します。
* 購入者 ID をストア取引へ紐付け、サーバーが確認してから付与・トランザクション完了。二重通知・復元では再付与せず、返金では同じ台帳へ減算。残高を使い切った後の返金で負残高になった場合、新たな応援に使えません。ストアによる返金取消通知だけが再加算できます。
* Google の売上金額は現在カタログ基準と表示し、ストア確定額・手数料確定額とは区別します。経理では Store の財務レポートと照合します。コイン消費と購入金額を二重に売上計上しません。
* Web 契約とアプリ契約の重複申込を拒否し、契約管理は購入したストアへ誘導します。契約期限切れは worker が Free に戻します。

Sandbox は本番 DB・API と分離し `APPLE_ENVIRONMENT=Sandbox`。実際のストアアカウントで、購入、承認待ち、通信断、キャンセル、復元、更新、猶予、失効、返金、返金取消を確認した後だけ有料機能を公開します。VPS・ドメイン・ストアアカウント等が未準備の現状では、実取引・実端末・審査合格は未確認です。

公式資料: [Apple Server Library](https://github.com/apple/app-store-server-library-node)、[Google purchases.productsv2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2)、[Google subscriptionsv2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2)、[Expo Push](https://docs.expo.dev/push-notifications/sending-notifications/)。
