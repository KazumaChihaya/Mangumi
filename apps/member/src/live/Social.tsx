import React, { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { api, upload } from "../api";
import { useStore } from "../store";
import { screenPath, type Screen } from "../registry";
import {
  Button,
  Empty,
  Field,
  Form,
  Notice,
  Panel,
  RouteLink,
  Row,
  Toggle,
} from "../ui";
import { useResource } from "./hooks";

function SignedAudio({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const renew = () => {
    void api(`/media/${id}/url`, {})
      .then((result) => {
        setUrl(result.url);
        setError("");
      })
      .catch((error) => setError(error.message));
  };
  useEffect(renew, [id]);
  return error ? (
    <Notice tone="error">{error}</Notice>
  ) : (
    <audio
      src={url || undefined}
      controls
      preload="none"
      onError={renew}
      style={{ width: "100%" }}
    />
  );
}
export function LiveDM({ screen }: { screen: Screen }) {
  const { notify } = useStore();
  const router = useRouter();
  const query = useLocalSearchParams<{ item?: string; message?: string }>();
  const conversations = useResource<any[]>("/conversations");
  const officials = useResource<any[]>("/officials", 0);
  const selected =
    conversations.data?.find((row) => row.id === query.item) ??
    conversations.data?.[0];
  const messages = useResource<any[]>(
    selected ? `/conversations/${selected.id}/messages` : undefined,
    3000,
  );
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<Blob>();
  const [preview, setPreview] = useState("");
  const [older, setOlder] = useState<any[]>([]);
  const [historyEnd, setHistoryEnd] = useState(false);
  useEffect(() => {
    setOlder([]);
    setHistoryEnd(false);
  }, [selected?.id]);
  const displayed = [...older, ...(messages.data ?? [])].filter(
    (message, index, rows) =>
      rows.findIndex((item) => item.id === message.id) === index,
  );
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const go = (id: string, item?: string) =>
    router.push(
      (screenPath(id) +
        (item ? `?item=${encodeURIComponent(item)}` : "")) as Href,
    );
  useEffect(
    () => () => {
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!recorded) return;
    const url = URL.createObjectURL(recorded);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [recorded]);
  useEffect(() => {
    if (selected && messages.data?.length)
      void api(`/conversations/${selected.id}`, { read: true }, "PATCH").catch(
        () => {},
      );
  }, [selected?.id, messages.data?.length]);
  const error = conversations.error || messages.error;
  if (["U055", "U058", "U064"].includes(screen.id))
    return (
      <>
        {error && <Notice tone="error">{error}</Notice>}
        <Panel title={screen.id === "U058" ? "公式メンバー" : "メッセージ"}>
          {screen.id === "U058"
            ? officials.data?.map((official) => (
                <Row
                  key={official.id}
                  title={official.name}
                  image={official.avatar}
                  end={
                    <Button
                      onClick={async () => {
                        const result = await api("/conversations", {
                          peer: official.id,
                        });
                        await conversations.reload();
                        go("U056", result.id);
                      }}
                    >
                      会話を開く
                    </Button>
                  }
                />
              ))
            : conversations.data?.map((conversation) => (
                <Row
                  key={conversation.id}
                  title={conversation.name}
                  sub={`${conversation.unread}件の未読${conversation.blocked ? " · ブロック中" : ""}`}
                  image={conversation.avatar}
                  end={
                    <Button onClick={() => go("U056", conversation.id)}>
                      開く
                    </Button>
                  }
                />
              ))}
          {!(screen.id === "U058"
            ? officials.data?.length
            : conversations.data?.length) && (
            <Empty
              icon="dm"
              title="会話をはじめよう"
              text="公式メンバーが公開されると、ここから会話できます。"
            />
          )}
        </Panel>
        <Button id="U058" tone="gold">
          公式メンバーから選ぶ
        </Button>
      </>
    );
  if (!selected)
    return (
      <Panel>
        <Empty
          title="会話を選んでください"
          text="公式メンバーとの会話を作成できます。"
          action={<Button id="U058">会話をはじめる</Button>}
        />
      </Panel>
    );
  if (screen.id === "U057")
    return (
      <Panel title="通報する">
        <Form
          submit="通報を送信"
          onSubmit={async (values) => {
            await api("/reports", {
              type: values.messageId ? "message" : "user",
              targetId: values.messageId || selected.peer,
              reason: values.reason,
            });
            notify("通報を受け付けました");
            go("U056", selected.id);
          }}
        >
          <label className="field">
            <span>通報対象</span>
            <select name="messageId" defaultValue={query.message ?? ""}>
              <option value="">相手のプロフィール</option>
              {messages.data?.map((message) => (
                <option key={message.id} value={message.id}>
                  {message.text?.slice(0, 40) || "音声メッセージ"}
                </option>
              ))}
            </select>
          </label>
          <Field name="reason" label="詳しい内容" multiline required />
        </Form>
      </Panel>
    );
  return (
    <>
      <Panel title={selected.name}>
        {error && <Notice tone="error">{error}</Notice>}
        {!historyEnd && (messages.data?.length ?? 0) >= 100 && (
          <Button
            tone="ghost"
            onClick={async () => {
              const oldest = displayed[0];
              const page = await api<any[]>(
                `/conversations/${selected.id}/messages?before=${encodeURIComponent(oldest.at)}&beforeId=${encodeURIComponent(oldest.id)}`,
              );
              setOlder([...page, ...older]);
              setHistoryEnd(page.length < 100);
            }}
          >
            以前のメッセージを読む
          </Button>
        )}
        <div className="chat-thread" aria-live="polite">
          {displayed.map((message) => (
            <div
              key={message.id}
              className={`chat-message ${message.mine ? "mine" : ""}`}
            >
              <div className="chat-bubble">
                <p>{message.text}</p>
                {message.mediaId && <SignedAudio id={message.mediaId} />}
                <small>
                  {new Date(message.at).toLocaleString("ja-JP")} ·{" "}
                  {message.retracted
                    ? "取消済み"
                    : message.status === "read"
                      ? "既読"
                      : "配信済み"}
                </small>
                {message.mine && !message.retracted && (
                  <Button
                    tone="ghost"
                    className="small"
                    onClick={async () => {
                      await api(
                        `/messages/${message.id}`,
                        { scope: "retract" },
                        "DELETE",
                      );
                      await messages.reload();
                    }}
                  >
                    送信取消
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {selected.blocked ? (
          <Notice>ブロック中は送受信できません。</Notice>
        ) : (
          <Form
            submit="送信"
            onSubmit={async () => {
              let mediaId;
              if (recorded)
                mediaId = (await upload(recorded, "audio", selected.id)).id;
              await api(
                `/conversations/${selected.id}/messages`,
                { text, mediaId },
                "POST",
                "member",
                crypto.randomUUID(),
              );
              setText("");
              setRecorded(undefined);
              await messages.reload();
            }}
          >
            <label className="field">
              <span>メッセージ</span>
              <textarea
                aria-label="メッセージ"
                name="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={2000}
              />
            </label>
            {preview && recorded && (
              <audio src={preview} controls style={{ width: "100%" }} />
            )}
            <Button
              tone="ghost"
              onClick={async () => {
                if (recording) {
                  recorder.current?.stop();
                  setRecording(false);
                  return;
                }
                const tracks = await navigator.mediaDevices.getUserMedia({
                  audio: true,
                });
                stream.current = tracks;
                const capture = new MediaRecorder(tracks);
                recorder.current = capture;
                const chunks: BlobPart[] = [];
                capture.ondataavailable = (event) => chunks.push(event.data);
                capture.onstop = () => {
                  setRecorded(new Blob(chunks, { type: capture.mimeType }));
                  setRecording(false);
                  tracks.getTracks().forEach((track) => track.stop());
                  if (timer.current) clearTimeout(timer.current);
                };
                capture.start();
                setRecording(true);
                timer.current = setTimeout(() => {
                  if (capture.state === "recording") capture.stop();
                }, 300000);
              }}
            >
              {recording ? "録音を停止" : "音声を録音"}
            </Button>
          </Form>
        )}
      </Panel>
      <Panel title="会話の設定">
        <Toggle
          label="この会話の通知をミュート"
          checked={selected.muted}
          onChange={async () => {
            await api(
              `/conversations/${selected.id}`,
              { muted: !selected.muted },
              "PATCH",
            );
            await conversations.reload();
          }}
        />
        <Button
          tone="danger"
          onClick={async () => {
            if (selected.blocked)
              await api(`/blocks/${selected.peer}`, undefined, "DELETE");
            else await api("/blocks", { userId: selected.peer });
            await conversations.reload();
          }}
        >
          {selected.blocked ? "ブロックを解除" : "相手をブロック"}
        </Button>
        <Button onClick={() => go("U057", selected.id)} tone="ghost">
          通報する
        </Button>
      </Panel>
    </>
  );
}
