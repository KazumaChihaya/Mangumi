# さくらVPSへの配置

VPS・ドメインはまだ契約されていない。ここではMangumi専用の新しいVPSに、既存の `infra/production/compose.yaml` を配置する手順を示す。ARROWのサーバー・DB・認証情報は使用しない。GitHub Pagesは引き続きサンプルデータの画面確認に使える。

## 用意するもの

- アプリ専用のVPSとSSH鍵。OSはUbuntu 24.04を想定する。[さくらの標準OS](https://manual.sakura.ad.jp/vps/os-packages/ubuntu-24.04.html)と[Docker Composeのスタートアップスクリプト対応表](https://manual.sakura.ad.jp/vps/startupscript/startupscript.html)を確認する。スクリプトへサービスの秘密情報を埋め込まない。
- ドメインとDNSの編集権限。例として `app.example.jp` を使い、AレコードをVPSの公開IPv4へ向ける。AAAAはIPv6での到達も確認できる場合に設定する。
- Mangumi専用のSMTP送信元、Stripeアカウント、LiveKit Cloudまたは別の音声用VPS。[外部サービスの設定](server-setup.md#外部サービス)を参照する。
- 別の障害領域にあるバックアップ先。暗号鍵・バックアップ復号鍵をサーバー本体だけに保管しない。

CPU・メモリ・ディスクの契約容量は、初期会員数、投稿と音声ファイルの量、配置後の測定結果から決める。開発機での負荷試験結果をVPSの性能保証として使わない。

## ネットワーク

さくらの[パケットフィルター](https://manual.sakura.ad.jp/vps/network/packetfilter.html)とOS側の設定の両方を確認する。Web/API用VPSではTCP 80・443を公開し、SSHは管理者の接続元に合わせる。固定IPのない外出先から管理する場合は、接続手段を確保してからSSHの許可元を絞る。HTTP/3を使う場合はUDP 443も許可する。

MariaDB 3306とAPI 3001は公開しない。ComposeはCaddyだけをホストへ公開する。音声基盤のTLS・TURN・通信ポートは[音声用の手順](../infra/livekit/README.md)に従い、Web用の設定と別に確認する。

## 初回配置

以下はVPS上のLinuxシェルで実行する。Docker EngineとComposeプラグインが必要。さくらのDocker Composeスクリプトを選ばなかった場合は、[Docker公式のUbuntu向け手順](https://docs.docker.com/engine/install/ubuntu/)に従う。`git` もインストールする。

```sh
git clone https://github.com/KazumaChihaya/Mangumi.git
cd Mangumi
umask 077
cp .env.example .env
docker build -t mangumi:deployment -f infra/production/Dockerfile .
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/keys" \
  -e KEYS_FILE=/keys/.env.keys.generated \
  mangumi:deployment node --import tsx src/cli.ts keys
chmod 600 .env .env.keys.generated
```

生成した `.env.keys.generated` の値を `.env` に移す。秘密値はターミナル履歴やチャットへ貼らず、サーバー上のエディターで編集する。生成済みの鍵ファイルは上書きされない。再配置のために暗号鍵を作り直す必要はない。

`.env` の `APP_DOMAIN=app.example.jp`、SMTP、差出人、VAPID_SUBJECT、Stripe、LiveKitを設定する。`APP_DOMAIN` は `https://` やパスを含まないホスト名。Composeが本番の `APP_ORIGIN`、DB接続先、ファイル領域を設定する。秘密値を `EXPO_PUBLIC_*` に設定しない。

```sh
docker compose --env-file .env -f infra/production/compose.yaml config --quiet
docker compose --env-file .env -f infra/production/compose.yaml up -d --build
docker compose --env-file .env -f infra/production/compose.yaml ps
```

DNSと80/443の疎通後、Caddyが証明書を取得する。`https://app.example.jp/api/health` が200で返り、会員画面と `/admin/A001` がHTTPSで開くことを確認する。外部サービス未設定時のreadinessエラーは設定が完了するまで解消しない。失敗時は `docker compose --env-file .env -f infra/production/compose.yaml logs --tail=100 api caddy` を確認し、ログを共有するときは個人情報・秘密値を除く。

### 初期管理者

サーバーのシェルでメールアドレスと12文字以上のパスワードを入力する。パスワードは画面に表示しない。

```sh
read -r -p '管理者メール: ' BOOTSTRAP_ADMIN_EMAIL
read -r -s -p '管理者パスワード: ' BOOTSTRAP_ADMIN_PASSWORD
echo
export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
docker compose --env-file .env -f infra/production/compose.yaml run --rm -T --no-deps \
  -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD \
  api node --import tsx src/cli.ts admin
unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
```

`/admin/A001` でログインし、認証アプリを登録、復旧コードを保管する。ブランド設定でロゴ・運営者の利用規約・プライバシーポリシー・問い合わせ先を設定する。本番の会員登録は必要な運営者情報が設定されるまで受け付けない。

## 接続確認と公開

1. SMTPから確認・再設定メールを受け取る。
2. StripeでプランのPrice IDと署名付きWebhookを設定し、テスト決済・重複通知・解約・返金・売上を確認する。イベント一覧は[サーバー設定](server-setup.md#外部サービス)を参照する。
3. 異なるネットワークの2端末で、LiveKitの発言・登壇変更・再接続・BANとTURNを確認する。
4. iPhoneとAndroidでホーム画面追加、Pushの購読・通知・クリック・解除を確認する。
5. 保存期間の初期設定、自動削除の対象プレビュー、バックアップ先・保持期間・復旧目標を設定する。空の隔離環境へ復元し、画像・ログイン・履歴を確認する。
6. テスト用の設定を本番用へ切り替え、少人数の受入後に公開する。設定を変更した環境変数は `docker compose ... up -d` でコンテナへ反映する。

## 更新と復旧

更新前に管理画面でメンテナンスを有効にし、[暗号化バックアップ](server-setup.md#暗号化バックアップの実装と復旧訓練)を別の保管先へ作成する。現在のリビジョンを記録してから `git pull --ff-only` と上記の `up -d --build` を実行し、health・ログイン・主要操作を確認する。Dockerの永続ボリュームにDB・アップロード・証明書を保持する。更新時に `down --volumes` を実行しない。

アプリだけを旧版へ戻してもDBの変更は戻らない。障害時はメンテナンスを継続し、記録したリビジョンとバックアップを空の隔離DB・ファイル領域へ復元してから切替を判断する。VPS契約後に実際の復旧所要時間と監視通知先を確定する。
