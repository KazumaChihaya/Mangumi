# 音声基盤

Web/APIホストと音声基盤を分離する。最初はLiveKit Cloud、または下記公式のVM構築手順で用意した単一ノードを使用する。

- [公式VM構築手順](https://docs.livekit.io/transport/self-hosting/vm/)
- [TLS・TURN・公開IP・ポートの要件](https://docs.livekit.io/transport/self-hosting/deployment/)

APIの `LIVEKIT_URL` は `wss://`、`LIVEKIT_API_KEY` と `LIVEKIT_API_SECRET` は音声基盤のキーを設定する。Webhookは `https://アプリのドメイン/api/webhooks/livekit` へ登録する。クライアントに秘密鍵を渡さない。

APIは2分の参加トークンを発行し、会員・対象プラン・定員・BAN・役割を検証する。参加者の権限更新・強制退出・ルーム終了はRoom Serviceを使用する。録音は初期設定の無効を維持する。

運用開始前に、異なるネットワークの2端末で接続、TURN経由、マイク拒否、再接続、ホスト切断、BAN後の再入室拒否を確認する。実基盤の設定前に音声の疎通を検証済みとは扱わない。
