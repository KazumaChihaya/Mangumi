import React from "react";
import { useResource } from "./hooks";
import { Notice, Panel } from "../ui";
export function LiveLegal({ privacy }: { privacy: boolean }) {
  const brand = useResource("/brand", 0);
  const url = privacy ? brand.data?.privacy : brand.data?.terms;
  return (
    <Panel title={privacy ? "プライバシーポリシー" : "利用規約"}>
      {url ? (
        <a
          className="button primary"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          本文を開く
        </a>
      ) : (
        <Notice>
          運営者が文書を準備しています。公開後にこちらから確認できます。
        </Notice>
      )}
      {brand.data?.contact && <p>お問い合わせ：{brand.data.contact}</p>}
    </Panel>
  );
}
