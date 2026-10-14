import React from "react";
import { publicPath } from "../src/web-path";
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,viewport-fit=cover"
        />
        <meta name="theme-color" content="#170c1e" />
        <meta
          name="description"
          content="マン組の公式ファンアプリ。配信、スペース、DM、ストーリーで最高の瞬間を一緒に。"
        />
        <link rel="manifest" href={publicPath("/manifest.json")} />
        <link rel="icon" href={publicPath("/icon.svg")} />
      </head>
      <body
        style={
          {
            "--chrome-frame": `url("${publicPath("/assets/cabinet-bezel-v2.png")}")`,
            "--cabinet-art": `url("${publicPath("/assets/mood-cabinet.png")}")`,
            "--gacha-art": `url("${publicPath("/assets/hero_gacha.jpg")}")`,
            "--admin-backdrop": `url("${publicPath("/assets/mood-admin.png")}")`,
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
