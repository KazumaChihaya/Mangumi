# パチスロ演出の見直し（2026-10-14）

基準：[雰囲気イメージ.zip](https://drive.google.com/file/d/1p5RTm8vqqdyCZJSG_iddc_FGokCEVDPW/view)。UI案のサイトマップは維持し、立体的な金属、赤い宝石ランプ、紫・青の光、金文字、赤い光沢ボタンを共通UIへ適用した。

- 全ページの共通テーマは apps/member/src/jackpot.css にまとめた。従来の形・レイアウトは global.css と cabinet.css を使用する。
- 素材 apps/member/public/assets/cabinet-bezel-v2.png は組み込み image_gen ツールで生成した。1254×1254、中央は透明（alpha 0）。旧SVGを残し、別名のPNGを追加した。
- PNGは9分割で使用する。正方形の角は四辺を同じ太さにし、辺は縦横同倍率の拡縮と `repeat` による繰り返し・切り抜きで配置する。画面の縦横比に合わせた引き伸ばしや `round` による変形は使用しない。フォーム・文字・操作はDOMのまま。
- ホームは配信の日時を大きく表示し、お知らせ、音声ルーム・ストーリー、DM、ガチャの入口を並べた。既定の配信アートは雰囲気画像の該当部分をCSSで表示し、管理画面で設定した画像も利用できる。
- 効果音と演出の切替を利用者ヘッダーへ移した。効果音は初期OFF。抽選開始は回転音、当選・保存は和音を重ねた効果音。OSの動きを減らす設定とアプリ内設定を尊重する。
- GitHub Pagesの /Mangumi/ 配下でも新しい素材と画面を配信する。

## フレームの比率修正（2026-10-14）

`border-image` の `stretch` と、外枠で画像を `700% 100%` に描画していた指定を修正した。利用者・管理者・全画面一覧の装飾へ同じ比率保持ルールを適用し、一辺のみの区切りは画像を使わず金色の罫線にした。元の1254×1254 PNGは変更していない。

[CSS仕様の描画規則](https://www.w3.org/TR/css-backgrounds-3/#border-image-process)に従い、辺は均等に拡縮した後に繰り返す。回帰確認では正方形・横長・縦長の枠を描画し、角と辺の中央のピクセルを比較する。GPUによるわずかな色の丸めのみを許容し、形の変化を検出する。ランプ・光沢・効果音は維持する。

## フレーム生成プロンプト

組み込み image_gen、transparent_background: true。人物・文字は生成せず、装飾素材だけを生成。

```text
Create one production-ready UI asset: a square, front-facing empty Japanese pachislot cabinet frame on a truly transparent background. High fidelity photorealistic 3D product rendering of polished mirror gold, black chrome and silver beveled machined metal, with sharply clipped octagonal corners, layered heavy mechanical rims, crimson jewel lamp clusters at the four corners and inset violet/blue light strips. Match extravagant Japanese pachislot visual language: specular highlights, gold reflections, tiny star glints, illuminated red acrylic, saturated neon, deep reflective chrome. This must look like a costly physical slot-machine bezel, not a flat gold line or generic fantasy frame. The frame is perfectly symmetrical, axis aligned, not in perspective. Design for CSS nine-slice: corners occupy approximately 18% of the square width; middle stretches of the four rails must be straight and simple enough to stretch smoothly. Keep decoration attached to the perimeter. Outer outline stays at the canvas edges, with no broad outer margin. The large central opening (roughly 74% of the width and height) and all space outside the frame are fully transparent. The middle opening must contain absolutely no image, color, black fill, checkerboard rendering or fog. No writing, letters, numerals, logo, person, mockup, panels, buttons, or backdrop. Output exactly one isolated square frame with alpha transparency, suitable for a Japanese fan app UI.
```
