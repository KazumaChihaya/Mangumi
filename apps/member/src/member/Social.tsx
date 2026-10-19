import React, { useEffect, useRef, useState } from "react";
import { publicPath } from "../web-path";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { screenPath, type Screen } from "../registry";
import { useStore } from "../store";
import {
  Badge,
  Button,
  Confirm,
  Empty,
  Field,
  Form,
  Hero,
  Icon,
  Notice,
  Panel,
  RouteLink,
  Row,
  Select,
  Toggle,
} from "../ui";
export function Waveform({ paused = false }: { paused?: boolean }) {
  return (
    <div
      className="waveform"
      style={{ animationPlayState: paused ? "paused" : "running" }}
      aria-hidden="true"
    >
      {Array.from({ length: 24 }, (_, index) => (
        <i
          key={index}
          style={
            {
              "--height": `${12 + ((index * 17) % 37)}px`,
              "--delay": `${index * 0.055}s`,
              animationPlayState: paused ? "paused" : "running",
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
export function StoryPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const [paused, setPaused] = useState(false);
  const router = useRouter();
  const story = state.stories.find((s) => s.id === item) ?? state.stories[0];
  useEffect(() => {
    if (story && ["U035", "U039"].includes(screen.id) && !story.viewed)
      void update((d) => {
        d.stories.find((s) => s.id === story.id)!.viewed = true;
      }).catch((error) => notify(error.message));
  }, [screen.id, story?.id]);
  if (!story)
    return (
      <Panel>
        <Empty
          title="公開中のストーリーはありません"
          text="次の更新をお楽しみに。"
        />
      </Panel>
    );
  if (
    screen.id === "U038" ||
    (["U035", "U039"].includes(screen.id) &&
      story.plan !== "Free" &&
      story.plan !== state.profile.plan)
  )
    return (
      <>
        <Hero
          asset="hero_story"
          label="MEMBERS ONLY"
          title="ここだけのマン組。"
        />
        <Panel>
          <Empty
            icon="shield"
            title="限定ストーリー"
            text="このストーリーは対象プランのメンバーに公開されています。"
            action={
              <Button id="U089" tone="gold">
                プランをチェック
              </Button>
            }
          />
        </Panel>
      </>
    );
  if (["U035", "U039"].includes(screen.id))
    return (
      <>
        <div className="story-view">
          <img src={publicPath(story.image)} alt={story.title} />
          <div className="story-progress">
            {state.stories.map((s) => (
              <i key={s.id} className={s.id === story.id ? "active" : ""} />
            ))}
          </div>
          <div className="story-caption">
            <Badge tone="pink">MANZOU STORY</Badge>
            <h2 style={{ marginTop: 12 }}>{story.title}</h2>
            <p>まんぞう / 3時間前</p>
          </div>
        </div>
        <div className="button-row">
          <Button tone="ghost" onClick={() => setPaused(!paused)}>
            {paused ? "再開" : "一時停止"}
          </Button>
          <Button
            onClick={() => {
              const index = state.stories.findIndex((s) => s.id === story.id);
              const next = state.stories[index + 1];
              router.push(
                (next
                  ? `${screenPath("U035")}?item=${next.id}`
                  : screenPath("U040")) as Href,
              );
            }}
          >
            次のストーリー
          </Button>
        </div>
        <small className="preview-note">
          画像ストーリーのプレビューです。動画素材が追加されると再生に対応します。
        </small>
      </>
    );
  if (screen.id === "U040")
    return (
      <Panel>
        <Empty
          icon="heart"
          title="見てくれてありがとう！"
          text="新しい日常も、またここで。通知をONにして待っていてね。"
          action={
            <Button id="U034" tone="gold">
              ストーリー一覧へ
            </Button>
          }
        />
      </Panel>
    );
  const stories = state.stories.filter((s) =>
    screen.id === "U036"
      ? s.status === "アーカイブ"
      : screen.id === "U037"
        ? s.highlight
        : s.status === "公開",
  );
  return (
    <>
      <Hero
        asset="hero_story"
        label="MANZOU STORIES"
        title="マン組の、いつもの日常。"
        text="実戦の裏側も、オフの顔も。ちょっとだけ近くに。"
      />
      <div className="tabs">
        {[
          ["U034", "最新"],
          ["U036", "アーカイブ"],
          ["U037", "ハイライト"],
        ].map(([id, label]) => (
          <RouteLink
            key={id}
            id={id}
            className={screen.id === id ? "active" : ""}
          >
            {label}
          </RouteLink>
        ))}
      </div>
      <div className="image-grid">
        {stories.map((s) => (
          <RouteLink id="U035" item={s.id} key={s.id} className="image-card">
            <img src={publicPath(s.image)} alt={s.title} />
            <div>
              <Badge tone={s.viewed ? "gray" : "pink"}>
                {s.viewed ? "VIEWED" : "NEW"}
              </Badge>
              <h3>{s.title}</h3>
              <p>{s.plan === "Free" ? "全メンバー公開" : `${s.plan}限定`}</p>
            </div>
          </RouteLink>
        ))}
      </div>
      {!stories.length && (
        <Panel>
          <Empty
            title="新しいストーリーを準備中"
            text="もう少しだけ待っていてね。"
          />
        </Panel>
      )}
    </>
  );
}
export function VoicePage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const router = useRouter();
  const [permission, setPermission] = useState("");
  const { item } = useLocalSearchParams<{ item?: string }>();
  const room =
    state.rooms.find((r) => r.id === (item ?? state.activeRoom)) ??
    state.rooms[0];
  const go = (id: string) => router.push(screenPath(id) as Href);
  const join = async () => {
    await update((d) => {
      d.activeRoom = room.id;
      d.muted = true;
    });
    go("U042");
  };
  if (["U041", "U043"].includes(screen.id))
    return (
      <>
        <Hero
          asset="hero_voice"
          label="MANZOU SPACE"
          title="声でつながる、特等席。"
          text="実戦のあとも、マン組と一緒に。気軽に聴きにきてね。"
        />
        <div className="tabs">
          <RouteLink id="U041" className={screen.id === "U041" ? "active" : ""}>
            開催中
          </RouteLink>
          <RouteLink id="U043" className={screen.id === "U043" ? "active" : ""}>
            予定・履歴
          </RouteLink>
        </div>
        {state.rooms
          .filter((r) =>
            screen.id === "U041"
              ? r.status === "開催中"
              : r.status !== "開催中",
          )
          .map((r) => (
            <Panel key={r.id} className="space-live">
              <span className="live-label">
                <span className="live-dot" />
                {r.status === "開催中" ? "LIVE NOW" : r.status}
              </span>
              <Row
                title={r.title}
                sub={`${r.host} · ${r.listeners}人`}
                image="/assets/avatar.jpg"
                id="U044"
                item={r.id}
              />
              <Button id="U044" className="full" tone="gold">
                {r.status === "開催中" ? "スペースに参加" : "詳細を見る"}
              </Button>
            </Panel>
          ))}
        <Button id="U050" tone="ghost" icon="plus">
          ルーム作成のプレビュー
        </Button>
      </>
    );
  if (screen.id === "U044")
    return (
      <>
        <Hero asset="hero_voice" label="LIVE SPACE" title={room.title} />
        <Panel title="ルームについて">
          <Row
            title={room.host}
            sub="ホスト / 公式配信者"
            image="/assets/avatar.jpg"
          />
          <dl className="detail-grid">
            <dt>公開範囲</dt>
            <dd>{room.plan}メンバー</dd>
            <dt>参加人数</dt>
            <dd>{room.listeners}人</dd>
            <dt>録音</dt>
            <dd>
              {state.settings.recording ? "有効（入室前に同意が必要）" : "無効"}
            </dd>
          </dl>
          <Notice>
            音声配信サービスは未接続です。参加・登壇・退出のUIをお試しいただけます。
          </Notice>
        </Panel>
        <Button
          id={state.settings.recording ? "U054" : "U045"}
          tone="gold"
          icon="mic"
        >
          {room.status === "開催中" ? "入室する" : "参加の準備をする"}
        </Button>
      </>
    );
  if (["U045", "U054"].includes(screen.id))
    return (
      <Panel className="confirmation">
        <Empty
          icon="mic"
          title={
            screen.id === "U054" ? "録音についてのご案内" : "マン組のスペースへ"
          }
          text={
            screen.id === "U054"
              ? "このルームは録音を行う設定です。利用目的はアーカイブの公開、保存期間は運営設定に従います。"
              : "リスナーとして参加します。聴くだけならマイクは使いません。"
          }
        />
        <Form
          submit={screen.id === "U054" ? "同意して入室" : "入室する"}
          onSubmit={join}
        >
          <label className="check-row">
            <input type="checkbox" required />
            {screen.id === "U054"
              ? "録音の説明を確認し、同意します"
              : "コミュニティのルールを守って参加します"}
          </label>
        </Form>
      </Panel>
    );
  if (screen.id === "U050")
    return (
      <Panel title="新しいスペース">
        <Form
          submit="ルームを作成"
          onSubmit={async (v) => {
            await update(
              (d) => {
                d.rooms.unshift({
                  id: crypto.randomUUID(),
                  title: v.title,
                  host: state.profile.name,
                  listeners: 0,
                  status: v.start === "今すぐ" ? "開催中" : "予定",
                  plan: v.plan,
                });
              },
              "音声ルーム作成",
              v.title,
            );
            notify("ルームを作成しました");
            go("U041");
          }}
        >
          <Field
            label="ルーム名"
            name="title"
            required
            placeholder="みんなでアフタートーク"
          />
          <Field label="説明" name="description" multiline />
          <Select label="開始" name="start" options={["今すぐ", "予約"]} />
          <Field label="予約日時" name="date" type="datetime-local" />
          <Select
            label="対象プラン"
            name="plan"
            options={["Free", "GOLD", "LEGEND"]}
          />
          <Notice>
            配信者権限と音声トークンの認証は本番APIで検証する設計です。
          </Notice>
        </Form>
      </Panel>
    );
  if (screen.id === "U046")
    return (
      <Panel>
        <Empty
          icon="mic"
          title="マイクを使う準備"
          text="登壇する場合のみ、マイクの許可が必要です。聴くだけでも参加できます。"
        />
        <Button
          className="full"
          onClick={async () => {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
              });
              stream.getTracks().forEach((t) => t.stop());
              setPermission(
                "マイクが利用できます。プレビューでは配信しません。",
              );
            } catch {
              setPermission(
                "マイクの許可を確認してください。リスナーとして参加できます。",
              );
            }
          }}
        >
          マイクの利用を確認
        </Button>
        {permission && <Notice>{permission}</Notice>}
        <Button id="U042" tone="ghost" className="full">
          リスナーとして戻る
        </Button>
      </Panel>
    );
  if (screen.id === "U051")
    return (
      <Panel>
        <Empty
          icon="user"
          title="ただいま満員です"
          text={`入室上限は${state.settings.roomLimit}人です。空きができたら再度お試しください。`}
          action={
            <Button
              onClick={() => {
                notify("参加人数を確認しました");
                go("U044");
              }}
            >
              もう一度確認
            </Button>
          }
        />
      </Panel>
    );
  if (screen.id === "U052")
    return (
      <Panel>
        <Empty
          icon="mic"
          title="接続を確認しています"
          text="ネットワークをご確認ください。入室し直すとルームに戻れます。"
          action={<Button onClick={join}>ルームへ戻る</Button>}
        />
      </Panel>
    );
  if (screen.id === "U053")
    return (
      <Panel>
        <Empty
          icon="heart"
          title="また一緒に話そう！"
          text="スペースに参加してくれてありがとう。次の開催もお楽しみに。"
          action={
            <Button id="U041" tone="gold">
              スペース一覧へ
            </Button>
          }
        />
      </Panel>
    );
  if (screen.id === "U049")
    return (
      <>
        <Panel title="登壇者の管理">
          {["まんぞう", "共同ホスト", state.profile.name].map((name, i) => (
            <Row
              key={name}
              title={name}
              sub={i === 0 ? "ホスト" : "スピーカー"}
              image="/assets/avatar.jpg"
              end={
                <Button
                  tone="ghost"
                  className="small"
                  onClick={() => notify(`${name}のミュート設定を更新しました`)}
                >
                  ミュート
                </Button>
              }
            />
          ))}
        </Panel>
        <Button
          tone="danger"
          onClick={async () => {
            await update(
              (d) => {
                d.activeRoom = null;
                d.rooms.find((r) => r.id === room.id)!.status = "終了";
              },
              "ルーム終了",
              room.title,
            );
            go("U053");
          }}
        >
          ルームを終了
        </Button>
      </>
    );
  return (
    <>
      <Panel className="space-live">
        <span className="live-label">
          <span className="live-dot" />
          LIVE SPACE / UI PREVIEW
        </span>
        <h2 style={{ textAlign: "center", margin: "18px 0 7px", fontSize: 20 }}>
          {room.title}
        </h2>
        <p style={{ textAlign: "center", color: "#b897ab", fontSize: 10 }}>
          {room.listeners}人が参加中
        </p>
        <div className="speaker-grid">
          {["まんぞう", "マン組", state.profile.name].map((name, i) => (
            <div className="speaker" key={name}>
              <img src={publicPath("/assets/avatar.jpg")} alt={name} />
              <strong>{name}</strong>
              <small>
                {i === 0
                  ? "ホスト"
                  : i === 1
                    ? "スピーカー"
                    : state.speaking
                      ? "登壇中"
                      : "リスナー"}
              </small>
            </div>
          ))}
        </div>
        <Waveform paused={state.muted} />
        {screen.id === "U047" && (
          <Notice>
            発言申請のプレビューです。承認されるとスピーカーになります。
          </Notice>
        )}
        <div className="button-row">
          <Button
            tone="ghost"
            icon="mic"
            onClick={async () => {
              await update((d) => {
                d.speaking = !d.speaking;
              });
              notify(
                state.speaking
                  ? "リスナーに戻りました"
                  : "発言申請をプレビューしました",
              );
            }}
          >
            {state.speaking ? "登壇をやめる" : "発言を申請"}
          </Button>
          <Button
            tone="ghost"
            icon={state.muted ? "mute" : "sound"}
            onClick={async () => {
              await update((d) => {
                d.muted = !d.muted;
              });
              notify(
                state.muted
                  ? "マイクONの表示に切り替えました"
                  : "マイクをミュートしました",
              );
            }}
          >
            {state.muted ? "ミュート" : "マイクON"}
          </Button>
        </div>
      </Panel>
      <Notice>
        音声サービスは未接続です。この画面で実際の音声は配信されません。
      </Notice>
      <div className="button-row">
        <Button id="U046" tone="ghost">
          マイク設定
        </Button>
        <Button
          tone="danger"
          onClick={async () => {
            await update((d) => {
              d.activeRoom = null;
              d.speaking = false;
            });
            go("U053");
          }}
        >
          退出する
        </Button>
      </div>
      <RouteLink id="U057" className="back-link">
        このルームを通報する
      </RouteLink>
    </>
  );
}
export function DMPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [audioURL, setAudioURL] = useState("");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const blobURL = useRef("");
  const router = useRouter();
  const go = (id: string) => router.push(screenPath(id) as Href);
  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (blobURL.current) URL.revokeObjectURL(blobURL.current);
    },
    [],
  );
  const send = async (text: string, audio = false) => {
    if (state.blocked) {
      notify("ブロック中はメッセージを送れません");
      return;
    }
    if (!navigator.onLine) {
      setError("オフラインです。接続してから再送してください。");
      return;
    }
    await update((d) => {
      d.messages.push({
        id: crypto.randomUUID(),
        text,
        mine: true,
        time: new Date().toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        audio,
      });
    });
    setMessage("");
    notify("プレビューにメッセージを追加しました");
  };
  if (["U055", "U058", "U064"].includes(screen.id))
    return (
      <>
        <Hero
          asset="hero_dm"
          label="DIRECT MESSAGE"
          title="気持ちを、まっすぐに。"
          text="応援のひとことも、ありがとうも。マン組に届けよう。"
        />
        <Panel title={screen.id === "U058" ? "公式アカウント" : "あなたの会話"}>
          {screen.id === "U064" ? (
            <Empty
              icon="dm"
              title="最初のひとことを送ろう"
              text="公式メンバーとの会話がここに並びます。"
              action={<Button id="U058">会話をはじめる</Button>}
            />
          ) : (
            <Row
              title="まんぞう"
              sub={
                screen.id === "U058"
                  ? "マン組 公式配信者"
                  : state.messages.at(-1)?.text
              }
              image="/assets/avatar.jpg"
              id="U056"
              end={<Badge tone="pink">公式</Badge>}
            />
          )}
        </Panel>
        <Button id="U058" tone="ghost" icon="plus">
          新しいDM
        </Button>
      </>
    );
  if (screen.id === "U057")
    return (
      <Panel title="安心して楽しむために">
        <Form
          submit="通報を送信"
          onSubmit={async (v) => {
            await update(
              (d) => {
                const reportId = crypto.randomUUID();
                d.reports.unshift({
                  id: reportId,
                  reason: v.reason + "：" + v.details,
                  target: "まんぞうとのDM",
                  status: "未対応",
                  assignee: "未割当",
                });
                d.records["evidence-" + reportId] = {
                  body: d.messages
                    .map(
                      (m) =>
                        m.time +
                        " / " +
                        (m.mine ? d.profile.name : "まんぞう") +
                        "：" +
                        m.text,
                    )
                    .join("\n"),
                  at: new Date().toISOString(),
                };
              },
              "通報作成",
              "DM",
            );
            notify("通報を受け付けました");
            go("U063");
          }}
        >
          <Select
            name="reason"
            label="通報理由"
            options={["不適切な発言", "迷惑行為", "個人情報の公開", "その他"]}
          />
          <Field name="details" label="詳しい内容" multiline required />
          <Notice>
            通報内容は対応のため運営が確認します。緊急の危険がある場合は、地域の緊急窓口へご連絡ください。
          </Notice>
        </Form>
        <div className="rule" />
        <Button
          tone="danger"
          className="full"
          onClick={async () => {
            await update((d) => {
              d.blocked = true;
            });
            notify("相手をブロックしました");
            go("U063");
          }}
        >
          この相手をブロック
        </Button>
      </Panel>
    );
  if (screen.id === "U063")
    return (
      <Panel>
        <Empty
          icon="shield"
          title={state.blocked ? "ブロックしました" : "通報を受け付けました"}
          text={
            state.blocked
              ? "ブロック中は新しいDMの送受信や招待を停止します。マイページから解除できます。"
              : "運営が内容を確認します。状況に応じて必要な対応を行います。"
          }
          action={
            <Button id="U055" tone="gold">
              DM一覧へ
            </Button>
          }
        />
      </Panel>
    );
  if (screen.id === "U062")
    return (
      <>
        <Panel title="会話の設定">
          <Toggle
            label="この会話をミュート"
            description="新しいDMの通知を受け取りません"
            checked={state.conversationMuted}
            onChange={(v) =>
              update((d) => {
                d.conversationMuted = v;
              })
            }
          />
          <Row title="通報・ブロック" id="U057" />
          <Row title="ブロック一覧" id="U097" />
        </Panel>
        <Button id="U056" tone="ghost">
          会話に戻る
        </Button>
      </>
    );
  if (screen.id === "U061")
    return (
      <Confirm
        title="送信を取り消しますか？"
        text="自分が送信した最後のメッセージを取り消します。"
        action="送信を取り消す"
        back="U056"
        onConfirm={async () => {
          await update((d) => {
            const index = d.messages.map((m) => m.mine).lastIndexOf(true);
            if (index >= 0) d.messages.splice(index, 1);
          });
          notify("メッセージを取り消しました");
          go("U056");
        }}
      />
    );
  if (screen.id === "U059")
    return (
      <>
        <Panel title="音声で伝えよう">
          <Empty
            icon="mic"
            title={
              recording ? "録音中…" : audioURL ? "録音を確認" : "声のメッセージ"
            }
            text={`録音は最大${state.settings.audioSeconds}秒・20MBです。このプレビューでは端末内で確認できます。`}
          />
          <Waveform paused={!recording} />
          {audioURL && (
            <audio controls src={audioURL} style={{ width: "100%" }} />
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            className="full"
            onClick={async () => {
              if (recording) {
                recorder.current?.stop();
                setRecording(false);
                return;
              }
              try {
                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: true,
                });
                streamRef.current = stream;
                const rec = new MediaRecorder(stream);
                recorder.current = rec;
                const chunks: Blob[] = [];
                rec.ondataavailable = (e) => chunks.push(e.data);
                rec.onstop = () => {
                  stream.getTracks().forEach((t) => t.stop());
                  setRecording(false);
                  if (stopTimer.current) clearTimeout(stopTimer.current);
                  const blob = new Blob(chunks, { type: rec.mimeType });
                  if (blob.size > 20 * 1024 * 1024) {
                    setError("録音が20MBを超えています");
                    return;
                  }
                  if (blobURL.current) URL.revokeObjectURL(blobURL.current);
                  blobURL.current = URL.createObjectURL(blob);
                  setAudioURL(blobURL.current);
                };
                rec.start();
                setRecording(true);
                stopTimer.current = setTimeout(
                  () => rec.state === "recording" && rec.stop(),
                  state.settings.audioSeconds * 1000,
                );
              } catch {
                setError("マイクの許可とブラウザの対応をご確認ください");
              }
            }}
          >
            {recording ? "録音を止める" : "録音する"}
          </Button>
          {audioURL && (
            <Button
              className="full"
              tone="gold"
              onClick={() => {
                send("音声メッセージのプレビュー", true);
                go("U056");
              }}
            >
              会話に音声表示を追加
            </Button>
          )}
        </Panel>
        <Button id="U056" tone="ghost">
          会話に戻る
        </Button>
      </>
    );
  return (
    <>
      <Panel
        title="まんぞう"
        action={
          <RouteLink id="U062">
            <Icon name="gear" size={18} />
          </RouteLink>
        }
      >
        <div className="chat-thread">
          {state.messages.map((m) => (
            <div className={`chat-message ${m.mine ? "mine" : ""}`} key={m.id}>
              <div className="chat-bubble">
                {m.audio ? (
                  <div className="audio-player">
                    <button
                      aria-label="音声の演出を再生"
                      onClick={() =>
                        notify("音声表示のプレビューです", "notify")
                      }
                    >
                      <Icon name="play" size={14} />
                    </button>
                    <Waveform />
                    <span>0:12</span>
                  </div>
                ) : (
                  m.text
                )}
              </div>
              <small>
                {m.mine ? "プレビュー · " : ""}
                {m.time}
              </small>
            </div>
          ))}
        </div>
        {screen.id === "U060" && (
          <Notice tone="error">
            送信できませんでした。
            <button
              className="button ghost small"
              onClick={() => {
                send("再送したメッセージ");
                go("U056");
              }}
            >
              再送する
            </button>
          </Notice>
        )}
        {state.blocked ? (
          <Notice>
            ブロック中のため送信できません。
            <RouteLink id="U097" className="underlined">
              解除する
            </RouteLink>
          </Notice>
        ) : (
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim()) send(message.trim());
            }}
          >
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="メッセージを入力…"
              aria-label="メッセージ"
              maxLength={2000}
            />
            <RouteLink id="U059" className="icon-button">
              <Icon name="mic" size={19} />
            </RouteLink>
            <Button type="submit" disabled={!message.trim()}>
              送信
            </Button>
          </form>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </Panel>
      <div className="button-row">
        <Button id="U061" tone="ghost">
          送信メニュー
        </Button>
        <Button id="U057" tone="ghost">
          通報・ブロック
        </Button>
      </div>
      <Notice>
        会話データはこのプレビューのブラウザセッション内だけで使用します。相手への実送信は行いません。
      </Notice>
    </>
  );
}
