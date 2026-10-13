import React from "react";
import { Button } from "../src/ui";
export default function NotFound() {
  return (
    <div className="not-found">
      <span className="eyebrow">MANZOU LOVE</span>
      <h1>このページは見つかりませんでした</h1>
      <p>リンクやアドレスを確認して、もう一度お試しください。</p>
      <Button id="U022" tone="gold">
        ホームに戻る
      </Button>
    </div>
  );
}
