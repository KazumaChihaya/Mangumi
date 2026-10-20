import React, { useEffect, useRef, useState } from "react";
import { nativeHost, nativeCall } from "../native-bridge";
import { api } from "../api";
import { useStore } from "../store";
import { Button, Notice, Panel, Row } from "../ui";
import { useResource } from "./hooks";
export function NativeConnection() {
  const { state } = useStore(),
    linked = useRef(""),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const host = nativeHost();
    if (!host || !state.profile.signedIn || !state.profile.verified) {
      linked.current = "";
      return;
    }
    if (linked.current === state.profile.email) return;
    let cancelled = false;
    void api(
      "/native/link",
      { nonce: host.nonce, platform: host.platform },
      "POST",
      "member",
    )
      .then(async (result) => {
        if (cancelled) return;
        await nativeCall("session.link", { code: result.code });
        linked.current = state.profile.email;
        setError("");
      })
      .catch((e) => {
        linked.current = "";
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [
    state.profile.email,
    state.profile.signedIn,
    state.profile.verified,
    attempt,
  ]);
  return error ? (
    <Notice>
      {error}
      <Button onClick={() => setAttempt((n) => n + 1)}>
        アプリのログイン連携を再試行
      </Button>
    </Notice>
  ) : null;
}
export function NativeStoreAccount() {
  const catalog = useResource(
      nativeHost() ? "/native/store/catalog" : undefined,
    ),
    [message, setMessage] = useState("");
  if (!nativeHost()) return null;
  return (
    <Panel title="ストアの購入と応援コイン">
      <p>応援コイン残高：{catalog.data?.balance ?? 0}コイン</p>
      {catalog.data?.subscription && (
        <p>
          契約状態：{catalog.data.subscription.status}／期限{" "}
          {new Date(catalog.data.subscription.expiresAt).toLocaleString(
            "ja-JP",
          )}
        </p>
      )}
      <Notice>
        アプリ内の購入はApp Store／Google
        Playで処理します。自動更新の停止はストアの契約管理で行ってください。カード情報はこのアプリに保存しません。
      </Notice>
      {message && <Notice>{message}</Notice>}
      {catalog.error && <Notice>{catalog.error}</Notice>}
      <Row
        title="購入を復元"
        sub="同じストアアカウントの有効な契約を確認します"
        end={
          <Button
            onClick={async () => {
              try {
                await nativeCall("billing.restore");
                await catalog.reload();
                setMessage("購入情報を確認しました");
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            復元する
          </Button>
        }
      />
      <Button
        onClick={async () => {
          await nativeCall("billing.manage");
        }}
      >
        ストアの契約管理を開く
      </Button>
    </Panel>
  );
}
