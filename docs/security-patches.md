# 依存のセキュリティ修正

`pnpm-workspace.yaml` の固定指定と `patches/` を必ず一緒に配布する。

| 対象 | 対応 | 検証 |
| --- | --- | --- |
| uuid | 11.1.1へ更新 | xcodeで必要なCommonJS互換、出力バッファ境界 |
| decode-uri-component | 修正版0.5.0へ更新し、既存query-stringのためCommonJS形式に調整 | 日本語・不正な%入力1万回・既存呼出元 |
| Vitest / mocker | 4.1.11へ更新 | モデルテスト |
| tinypool | 2.1.2以上へ固定 | Vitest実行 |
| braces | パーサーとcompile・expand・stringifyの再帰に128段の深さ制限を追加 | 深さ1万の文字列、深さ1000のAST、通常の範囲展開 |
| node-forge | RSA DigestInfo内のDigestAlgorithm要素数を厳密化 | 正常署名の成功、余分な要素を含む署名の拒否 |

braces 3.0.3とnode-forge 1.4.0には、確認時点で修正版の公開がない。バージョン番号による `pnpm audit` にはこの2件が残るため、監査ゼロ件とは扱わない。ソースへ修正を適用し、`pnpm test:security` で実際にインストールされたコードを検査する。CIの `check-audit.mjs` はこの2件・対象バージョン・修正ファイルだけを照合し、それ以外の勧告があれば失敗する。APIの本番コンテナにはこれらのExpo用ビルド依存を含めない。

出典：[uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq)、[decoder](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)、[Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)、[tinypool 1](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)、[tinypool 2](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)、[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv)。
