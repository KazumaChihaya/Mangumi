import { Platform, PermissionsAndroid } from "react-native";
import { AudioSession } from "@livekit/react-native";
import { Room, RoomEvent, Track } from "livekit-client";
import notifee, {
  AndroidImportance,
  AndroidForegroundServiceType,
} from "@notifee/react-native";
import type { NativeSession } from "./client";
export type VoiceState = {
  active: string;
  connected: boolean;
  muted: boolean;
  role: string;
  quality: string;
  error: string;
};
export class NativeVoice {
  state: VoiceState = {
    active: "",
    connected: false,
    muted: true,
    role: "listener",
    quality: "unknown",
    error: "",
  };
  private room?: Room;
  private timer?: ReturnType<typeof setInterval>;
  private joining = false;
  private reconnects = 0;
  constructor(
    private session: NativeSession,
    private changed: (state: VoiceState) => void,
  ) {}
  private update(values: Partial<VoiceState>) {
    this.state = { ...this.state, ...values };
    this.changed(this.state);
  }
  private async foreground(microphone = false) {
    if (Platform.OS !== "android") return;
    const channelId = await notifee.createChannel({
      id: "mangumi-voice",
      name: "音声ルームへの参加",
      importance: AndroidImportance.LOW,
      sound: undefined,
    });
    await notifee.displayNotification({
      id: "mangumi-voice",
      title: "まんぞうラブ · 音声ルーム",
      body: microphone ? "マイクがONです" : "音声ルームを聴いています",
      android: {
        channelId,
        asForegroundService: true,
        ongoing: true,
        pressAction: { id: "default" },
        foregroundServiceTypes: microphone
          ? [
              AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
              AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            ]
          : [
              AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            ],
      },
    });
  }
  async join(id: string) {
    if (this.joining) throw new Error("接続をお待ちください");
    this.joining = true;
    try {
      await this.leave();
      const response = await this.session.request(
        `/api/voice-rooms/${encodeURIComponent(id)}/token`,
        {},
      );
      const room = new Room({ adaptiveStream: true, dynacast: true });
      this.room = room;
      this.update({ active: id });
      room.on(RoomEvent.Reconnecting, () => {
        this.reconnects++;
        this.update({ connected: false, error: "再接続しています…" });
      });
      room.on(RoomEvent.Reconnected, () =>
        this.update({ connected: true, error: "" }),
      );
      room.on(RoomEvent.Disconnected, () => {
        if (this.room === room) {
          this.update({
            connected: false,
            error: "接続が切れました。再参加できます",
          });
          void this.leave().catch(() => {});
        }
      });
      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (participant === room.localParticipant) this.update({ quality });
      });
      room.on(RoomEvent.ParticipantPermissionsChanged, (_old, participant) => {
        if (
          participant === room.localParticipant &&
          !participant.permissions?.canPublish
        ) {
          void participant.setMicrophoneEnabled(false);
          this.update({ muted: true });
          void this.foreground(false);
        }
      });
      try {
        await AudioSession.startAudioSession();
        await this.foreground();
        await room.connect(response.url, response.token);
      } catch (error) {
        await this.session
          .request(`/api/voice-rooms/${encodeURIComponent(id)}/leave`, {})
          .catch(() => {});
        await this.leave();
        throw error;
      }
      this.reconnects = 0;
      this.update({
        active: id,
        connected: true,
        role: response.role,
        muted: true,
        error: "",
      });
      this.timer = setInterval(async () => {
        let rtt: number | undefined, packetLoss: number | undefined;
        const stats = await room.localParticipant
          .getTrackPublication(Track.Source.Microphone)
          ?.track?.getRTCStatsReport()
          .catch(() => undefined);
        stats?.forEach((stat) => {
          if (
            stat.type === "candidate-pair" &&
            stat.state === "succeeded" &&
            typeof stat.currentRoundTripTime === "number"
          )
            rtt = Math.min(
              60000,
              Math.max(0, stat.currentRoundTripTime * 1000),
            );
          if (
            stat.type === "remote-inbound-rtp" &&
            typeof stat.fractionLost === "number"
          )
            packetLoss = Math.min(1, Math.max(0, stat.fractionLost));
        });
        void this.session
          .request(`/api/voice-rooms/${encodeURIComponent(id)}/quality`, {
            quality: room.localParticipant.connectionQuality,
            reconnects: this.reconnects,
            ...(rtt !== undefined ? { rtt } : {}),
            ...(packetLoss !== undefined ? { packetLoss } : {}),
          })
          .catch(() => {});
      }, 30000);
      return this.state;
    } finally {
      this.joining = false;
    }
  }
  async microphone() {
    if (!this.room) throw new Error("音声ルームに参加してください");
    if (this.state.muted && !this.room.localParticipant.permissions?.canPublish)
      throw new Error("発言者に選ばれるとマイクを使えます");
    if (this.state.muted && Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED)
        throw new Error("端末の設定でマイクを許可してください");
    }
    try {
      await this.foreground(this.state.muted);
      await this.room.localParticipant.setMicrophoneEnabled(this.state.muted);
    } catch (error) {
      await this.foreground(false);
      throw error;
    }
    this.update({ muted: !this.state.muted });
    return this.state;
  }
  async leave() {
    const active = this.state.active,
      previous = this.room;
    this.room = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await previous?.disconnect();
    await AudioSession.stopAudioSession();
    if (Platform.OS === "android") await notifee.stopForegroundService();
    this.update({ active: "", connected: false, muted: true });
    if (active)
      await this.session
        .request(`/api/voice-rooms/${encodeURIComponent(active)}/leave`, {})
        .catch(() => {});
    return this.state;
  }
}
