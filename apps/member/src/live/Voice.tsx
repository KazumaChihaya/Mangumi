import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { useLocalSearchParams } from "expo-router";
import { api } from "../api";
import { useStore } from "../store";
import type { Screen } from "../registry";
import { Button, Empty, Field, Form, Notice, Panel, Row } from "../ui";
import { useResource } from "./hooks";
import { OfficialRoom } from "./Official";

type Voice = {
  active: string;
  connected: boolean;
  muted: boolean;
  role: string;
  error: string;
  quality: string;
  join: (id: string) => Promise<void>;
  leave: () => Promise<void>;
  microphone: () => Promise<void>;
  startAudio: () => Promise<void>;
};
const Context = createContext<Voice | null>(null);
export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { update, state } = useStore();
  const room = useRef<Room | undefined>(undefined);
  const [active, setActive] = useState("");
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(true);
  const [role, setRole] = useState("listener");
  const [error, setError] = useState("");
  const [quality, setQuality] = useState("unknown");
  const reconnects = useRef(0);
  const elements = useRef(new Set<HTMLMediaElement>());
  const connecting = useRef(false);
  async function leave() {
    const id = active;
    const previous = room.current;
    room.current = undefined;
    previous?.disconnect();
    elements.current.forEach((element) => element.remove());
    elements.current.clear();
    setActive("");
    setConnected(false);
    setMuted(true);
    await update((state) => {
      state.activeRoom = null;
      state.speaking = false;
    });
    if (id) await api(`/voice-rooms/${id}/leave`, {});
  }
  async function join(id: string) {
    if (connecting.current) throw new Error("接続が完了するまでお待ちください");
    connecting.current = true;
    try {
      await connectRoom(id);
    } finally {
      connecting.current = false;
    }
  }
  async function connectRoom(id: string) {
    if (room.current) await leave();
    const response = await api(`/voice-rooms/${id}/token`, {});
    const next = new Room({ adaptiveStream: true, dynacast: true });
    room.current = next;
    next.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        element.style.display = "none";
        document.body.append(element);
        elements.current.add(element);
      }
    });
    next.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => {
        elements.current.delete(element);
        element.remove();
      });
    });
    next.on(RoomEvent.Disconnected, () => {
      if (room.current !== next) return;
      setConnected(false);
      setError("音声ルームから切断されました。再接続できます。");
    });
    next.on(RoomEvent.Reconnecting, () => {
      reconnects.current++;
      setError("再接続しています…");
    });
    next.on(RoomEvent.ConnectionQualityChanged, (value, participant) => {
      if (participant === next.localParticipant) setQuality(value);
    });
    next.on(RoomEvent.Reconnected, () => {
      setConnected(true);
      setError("");
    });
    next.on(
      RoomEvent.ParticipantPermissionsChanged,
      (_previous, participant) => {
        if (
          participant === next.localParticipant &&
          !participant.permissions?.canPublish
        ) {
          setMuted(true);
          void next.localParticipant
            .setMicrophoneEnabled(false)
            .catch(() => {});
        }
      },
    );
    try {
      await next.connect(response.url, response.token);
      await next.startAudio();
      setActive(id);
      setConnected(true);
      setRole(response.role);
      setError("");
      await update((state) => {
        state.activeRoom = id;
        state.speaking = response.role !== "listener";
        state.muted = true;
      });
    } catch (error) {
      next.disconnect();
      room.current = undefined;
      await api(`/voice-rooms/${id}/leave`, {}).catch(() => {});
      throw error;
    }
  }
  useEffect(
    () => () => {
      room.current?.disconnect();
      elements.current.forEach((element) => element.remove());
    },
    [],
  );
  useEffect(() => {
    if (!state.profile.signedIn && room.current) void leave().catch(() => {});
  }, [state.profile.signedIn]);
  useEffect(() => {
    if (!active || !connected) return;
    const timer = setInterval(async () => {
      const current = room.current;
      if (!current) return;
      let rtt: number | undefined, packetLoss: number | undefined;
      const publication = current.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      const stats = await publication?.track
        ?.getRTCStatsReport()
        .catch(() => undefined);
      stats?.forEach((stat) => {
        if (
          stat.type === "candidate-pair" &&
          stat.state === "succeeded" &&
          typeof stat.currentRoundTripTime === "number"
        )
          rtt = Math.min(60000, Math.max(0, stat.currentRoundTripTime * 1000));
        if (
          stat.type === "remote-inbound-rtp" &&
          typeof stat.fractionLost === "number"
        )
          packetLoss = Math.min(1, Math.max(0, stat.fractionLost));
      });
      await api(`/voice-rooms/${active}/quality`, {
        quality: current.localParticipant.connectionQuality,
        reconnects: reconnects.current,
        ...(rtt !== undefined ? { rtt } : {}),
        ...(packetLoss !== undefined ? { packetLoss } : {}),
      }).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [active, connected]);
  const value: Voice = {
    active,
    connected,
    muted,
    role,
    error,
    quality,
    join,
    leave,
    microphone: async () => {
      if (!room.current) throw new Error("ルームに参加してください");
      await room.current.localParticipant.setMicrophoneEnabled(muted);
      setMuted(!muted);
    },
    startAudio: async () => {
      await room.current?.startAudio();
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useVoice() {
  const value = useContext(Context);
  if (!value) throw new Error("VoiceProvider is required");
  return value;
}
export function LiveVoice({ screen }: { screen: Screen }) {
  const { state, userId, role, refresh } = useStore();
  const voice = useVoice();
  const query = useLocalSearchParams<{ item?: string }>();
  const [selectedId, setSelectedId] = useState(query.item ?? "");
  const room =
    state.rooms.find(
      (room) => room.id === (selectedId || query.item || voice.active),
    ) ?? state.rooms[0];
  const participants = useResource<any[]>(
    room ? `/voice-rooms/${room.id}/participants` : undefined,
    3000,
  );
  const self = participants.data?.find(
    (participant) => participant.userId === userId,
  );
  const admin = screen.area === "admin";
  const moderate = admin || self?.role === "host" || self?.role === "cohost";
  return (
    <>
      {!admin && <OfficialRoom />}
      <Panel title="マン組の音声ルーム">
        {voice.connected && <p>接続品質：{voice.quality}</p>}
        {voice.error && <Notice>{voice.error}</Notice>}
        {participants.error && (
          <Notice tone="error">{participants.error}</Notice>
        )}
        {!state.rooms.length && (
          <Empty
            icon="mic"
            title="開催中のルームはありません"
            text="次回の開催をお楽しみに。"
          />
        )}
        {state.rooms.map((item) => (
          <Row
            key={item.id}
            title={item.title}
            sub={`${item.host} · ${item.status}`}
            end={
              admin ? (
                <Button onClick={() => setSelectedId(item.id)}>管理する</Button>
              ) : item.status === "開催予定" &&
                (item as any).hostId === userId ? (
                <Button
                  onClick={async () => {
                    await api(`/voice-rooms/${item.id}/start`, {});
                    await refresh();
                  }}
                >
                  ルームを開始する
                </Button>
              ) : (
                <Button
                  disabled={!["公開", "開催中"].includes(item.status)}
                  onClick={() => voice.join(item.id)}
                >
                  参加する
                </Button>
              )
            }
          />
        ))}
        {voice.active && (
          <>
            <div className="button-row" aria-label="リアクション">
              {["❤️", "👏", "🔥", "😂", "🎉"].map((emoji) => (
                <Button
                  key={emoji}
                  tone="ghost"
                  onClick={() =>
                    api(`/voice-rooms/${voice.active}/reaction`, { emoji })
                  }
                >
                  {emoji}
                </Button>
              ))}
            </div>
            <Notice>
              {voice.connected ? "音声に接続しています" : "接続が切れています"}
            </Notice>
            <Button tone="ghost" onClick={voice.startAudio}>
              音声の再生を許可する
            </Button>
            {["host", "cohost", "speaker"].includes(
              self?.role ?? "listener",
            ) && (
              <Button onClick={voice.microphone}>
                {voice.muted ? "マイクをON" : "マイクをOFF"}
              </Button>
            )}
            <Button
              onClick={async () => {
                await api(`/voice-rooms/${voice.active}/hand`, {
                  raised: !self?.hand,
                });
                await participants.reload();
              }}
            >
              {self?.hand ? "登壇申請を取り下げる" : "登壇を申請する"}
            </Button>
            {!voice.connected && (
              <Button onClick={() => voice.join(voice.active)}>再接続</Button>
            )}
            <Button tone="danger" onClick={voice.leave}>
              退出する
            </Button>
          </>
        )}
      </Panel>
      {room && (
        <Panel title="参加者">
          {participants.data?.map((participant) => (
            <Row
              key={participant.id}
              title={
                participant.userId === userId
                  ? "あなた"
                  : (participant.name ?? participant.userId)
              }
              sub={`${({ host: "ホスト", cohost: "共同ホスト", speaker: "スピーカー", listener: "リスナー" } as any)[participant.role] ?? participant.role}${participant.hand ? " · 登壇希望" : ""}${participant.reactionAt && Date.now() - Date.parse(participant.reactionAt) < 5000 ? ` ${participant.reaction}` : ""}`}
              end={
                moderate && participant.userId !== userId ? (
                  <div className="button-row">
                    {["speaker", "listener", "mute", "remove", "ban"].map(
                      (action) => (
                        <Button
                          key={action}
                          tone="ghost"
                          className="small"
                          onClick={async () => {
                            await api(`/voice-rooms/${room.id}/moderate`, {
                              userId: participant.userId,
                              action,
                              reason: "司会による参加者管理",
                            });
                            await participants.reload();
                          }}
                        >
                          {
                            (
                              {
                                speaker: "登壇許可",
                                listener: "リスナーへ",
                                mute: "ミュート",
                                remove: "退出",
                                ban: "入室禁止",
                              } as Record<string, string>
                            )[action]
                          }
                        </Button>
                      ),
                    )}
                  </div>
                ) : undefined
              }
            />
          ))}
          {moderate && (
            <Form
              submit="ルームを終了"
              onSubmit={async (values) => {
                await api(`/voice-rooms/${room.id}/moderate`, {
                  userId: userId ?? "",
                  action: "end",
                  reason: values.reason,
                });
                await voice.leave();
                await refresh();
              }}
            >
              <Field name="reason" label="終了理由" required />
            </Form>
          )}
        </Panel>
      )}
      {room && !admin && (
        <Panel title="運営に通報">
          <Form
            submit="通報する"
            onSubmit={async (values) => {
              await api("/reports", {
                type: "room",
                targetId: room.id,
                reason: values.reason,
              });
            }}
          >
            <Field name="reason" label="通報内容" multiline required />
          </Form>
        </Panel>
      )}
    </>
  );
}
