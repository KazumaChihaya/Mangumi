import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  ImageBackground,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { WebViewSource } from "react-native-webview/lib/WebViewTypes";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
  createAudioPlayer,
  type AudioPlayer,
} from "expo-audio";
import { File } from "expo-file-system";
import { NativeSession, NativeApiError } from "./src/client";
import { NativeVoice, type VoiceState } from "./src/voice";
import { NativeBilling, type Paywall } from "./src/billing";
import { localDestination } from "./src/navigation";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
const storage = {
  get: SecureStore.getItemAsync,
  set: SecureStore.setItemAsync,
  remove: SecureStore.deleteItemAsync,
};
export default function App() {
  const origin = String(Constants.expoConfig?.extra?.appOrigin ?? "").replace(
    /\/$/,
    "",
  );
  const web = useRef<WebView>(null),
    session = useRef<NativeSession | undefined>(undefined),
    voice = useRef<NativeVoice | undefined>(undefined),
    billing = useRef<NativeBilling | undefined>(undefined);
  const [source, setSource] = useState<WebViewSource>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [canGoBack, setCanGoBack] = useState(false),
    [paywall, setPaywall] = useState<Paywall | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>({
    active: "",
    connected: false,
    muted: true,
    role: "listener",
    quality: "unknown",
    error: "",
  });
  const [nonce, setNonce] = useState(""),
    currentPath = useRef("/"),
    recordingUri = useRef<string | undefined>(undefined),
    audioTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    player = useRef<AudioPlayer | undefined>(undefined);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const emit = (name: string, detail: unknown) =>
    web.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent(${JSON.stringify(name)},{detail:${JSON.stringify(detail)}}));true;`,
    );
  const warn = (text: string) => Alert.alert("まんぞうラブ", text);
  const navigate = async (path: string) => {
    currentPath.current = localDestination(path, origin);
    if (session.current?.userId)
      setSource(await session.current.webSource(currentPath.current));
    else setSource({ uri: `${origin}${currentPath.current}` });
  };
  const stopRecording = async () => {
    if (audioTimer.current) clearTimeout(audioTimer.current);
    audioTimer.current = undefined;
    if (recorder.isRecording) await recorder.stop();
    recordingUri.current = recorder.uri ?? recordingUri.current;
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });
    return { ready: !!recordingUri.current, recording: false };
  };
  const discard = async () => {
    if (!recorder.isRecording && !recordingUri.current) return;
    await stopRecording();
    player.current?.remove();
    player.current = undefined;
    const uri = recordingUri.current;
    recordingUri.current = undefined;
    if (uri) {
      const file = new File(uri);
      if (file.exists) file.delete();
    }
  };
  useEffect(() => {
    let disposed = false;
    const boot = async () => {
      try {
        const address = new URL(origin);
        if (
          address.origin !== origin ||
          (address.protocol !== "https:" &&
            !(
              __DEV__ &&
              ["localhost", "127.0.0.1", "10.0.2.2"].includes(address.hostname)
            ))
        )
          throw new Error(
            "EXPO_PUBLIC_APP_ORIGINにアプリのHTTPS接続先を設定してください",
          );
        let install = await SecureStore.getItemAsync("mangumi.installation");
        if (!install) {
          install = Crypto.randomUUID();
          await SecureStore.setItemAsync("mangumi.installation", install);
        }
        if (disposed) return;
        setNonce(install);
        const api = new NativeSession(origin, install, storage);
        session.current = api;
        voice.current = new NativeVoice(api, (value) => {
          if (!disposed) {
            setVoiceState({ ...value });
            emit("mangumi-native-voice", value);
          }
        });
        billing.current = new NativeBilling(api, setPaywall, warn);
        let initial = "/";
        const link = await Linking.getInitialURL();
        if (link) initial = localDestination(link, origin);
        const notification =
          await Notifications.getLastNotificationResponseAsync();
        if (notification?.notification.request.content.data?.url)
          initial = localDestination(
            notification.notification.request.content.data.url,
            origin,
          );
        if (notification)
          await Notifications.clearLastNotificationResponseAsync();
        currentPath.current = initial;
        if (await SecureStore.getItemAsync("mangumi.refresh")) {
          try {
            await api.refresh();
            if (!disposed) setSource(await api.webSource(initial));
          } catch (reason) {
            if (
              reason instanceof NativeApiError &&
              [401, 403].includes(reason.status)
            ) {
              if (!disposed) setSource({ uri: `${origin}${initial}` });
            } else throw reason;
          }
        } else if (!disposed) setSource({ uri: `${origin}${initial}` });
      } catch (reason) {
        if (!disposed) setError((reason as Error).message);
      } finally {
        if (!disposed) setBusy(false);
      }
    };
    void boot();
    const linkSub = Linking.addEventListener("url", (event) => {
      void navigate(localDestination(event.url, origin)).catch((e) =>
        setError(e.message),
      );
    });
    const pushSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data ?? {};
        if (data.deliveryId && session.current?.userId)
          void session.current
            .request(
              `/api/notifications/${encodeURIComponent(String(data.deliveryId))}/click`,
              {},
            )
            .catch(() => {});
        void navigate(localDestination(data.url, origin)).catch((e) =>
          setError(e.message),
        );
      },
    );
    const appSub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && recorder.isRecording)
        void stopRecording().then((value) =>
          emit("mangumi-native-audio", value),
        );
      if (state === "active" && session.current?.userId)
        void billing.current?.restore().catch(() => {});
    });
    return () => {
      disposed = true;
      linkSub.remove();
      pushSub.remove();
      appSub.remove();
      void voice.current?.leave();
      void billing.current?.close();
      void discard();
    };
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);
  const enablePush = async () => {
    if (!Device.isDevice)
      throw new Error("通知は実機の開発ビルドまたは配布版で確認してください");
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId)
      throw new Error("EAS Project IDと通知資格情報の設定が必要です");
    if (Platform.OS === "android")
      await Notifications.setNotificationChannelAsync("mangumi", {
        name: "マン組からのお知らせ",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted)
      throw new Error("端末のアプリ設定から通知を許可してください");
    const token = (await Notifications.getExpoPushTokenAsync({ projectId }))
      .data;
    return session.current!.request("/api/native/push", {
      token,
      label: `${Device.deviceName ?? Device.modelName ?? Platform.OS}`.slice(
        0,
        100,
      ),
    });
  };
  const onMessage = async (event: WebViewMessageEvent) => {
    let message: any;
    try {
      if (
        new URL(event.nativeEvent.url).origin !== origin ||
        event.nativeEvent.data.length > 40000
      )
        throw new Error("信頼できない画面からの操作です");
      message = JSON.parse(event.nativeEvent.data);
      if (
        message.version !== 1 ||
        typeof message.id !== "string" ||
        !/^[a-z\d-]{36}$/i.test(message.id)
      )
        throw new Error("端末操作の形式が正しくありません");
      const params = message.params ?? {},
        api = session.current;
      if (!api) throw new Error("初期化中です");
      let result: any;
      switch (message.method) {
        case "session.link":
          await api.link(String(params.code));
          result = { linked: true };
          void billing.current?.restore().catch(() => {});
          break;
        case "session.logout":
          await voice.current?.leave();
          await api.logout();
          await discard();
          result = { ok: true };
          break;
        case "session.restore":
          await navigate(currentPath.current);
          result = { ok: true };
          break;
        case "push.enable":
          result = await enablePush();
          break;
        case "push.settings":
          await Linking.openSettings();
          result = { ok: true };
          break;
        case "voice.join":
          result = await voice.current!.join(String(params.id));
          break;
        case "voice.leave":
          result = await voice.current!.leave();
          break;
        case "voice.microphone":
          result = await voice.current!.microphone();
          break;
        case "voice.state":
          result = voice.current!.state;
          break;
        case "billing.checkout":
          result = await billing.current!.open(params);
          break;
        case "billing.manage":
          result = await billing.current!.manage();
          break;
        case "billing.restore":
          result = await billing.current!.restore();
          break;
        case "audio.start": {
          if (voice.current?.state.active)
            throw new Error("音声ルームを退出してから録音してください");
          if (!(await AudioModule.requestRecordingPermissionsAsync()).granted)
            throw new Error("マイクの許可が必要です");
          await discard();
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
          });
          await recorder.prepareToRecordAsync();
          recorder.record();
          audioTimer.current = setTimeout(
            () => {
              void stopRecording().then((value) =>
                emit("mangumi-native-audio", value),
              );
            },
            Math.min(300, Math.max(1, Number(params.maxSeconds) || 300)) * 1000,
          );
          result = { recording: true, ready: false };
          break;
        }
        case "audio.stop":
          result = await stopRecording();
          break;
        case "audio.discard":
          await discard();
          result = { ready: false, recording: false };
          break;
        case "audio.play":
          if (!recordingUri.current) throw new Error("録音がありません");
          player.current?.remove();
          player.current = createAudioPlayer(recordingUri.current);
          player.current.play();
          result = { playing: true };
          break;
        case "audio.upload": {
          if (!recordingUri.current) throw new Error("録音がありません");
          const conversationId = String(params.conversationId);
          if (!/^[a-z\d_-]{1,100}$/i.test(conversationId))
            throw new Error("会話を確認してください");
          const form = new FormData();
          form.append("file", {
            uri: recordingUri.current,
            name: "voice.m4a",
            type: "audio/mp4",
          } as any);
          result = await api.request(
            `/api/uploads?kind=audio&conversationId=${encodeURIComponent(conversationId)}`,
            form,
          );
          break;
        }
        default:
          throw new Error("対応していない端末操作です");
      }
      emit("mangumi-native-result", { id: message.id, result });
    } catch (reason) {
      if (message?.id)
        emit("mangumi-native-result", {
          id: message.id,
          error: (reason as Error).message,
        });
    }
  };
  const external = (url: string) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" && !/(^|\.)stripe\.com$/.test(u.hostname))
        void Linking.openURL(url);
      else if (u.protocol === "mailto:") void Linking.openURL(url);
    } catch {}
  };
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        {!source || error ? (
          <ImageBackground
            source={require("../member/public/assets/mood-cabinet.png")}
            resizeMode="cover"
            style={styles.splash}
          >
            <View style={styles.card}>
              <Text style={styles.title}>まんぞうラブ</Text>
              {busy ? (
                <ActivityIndicator color="#ffd65c" />
              ) : (
                <>
                  <Text style={styles.text}>
                    {error || "接続を準備しています"}
                  </Text>
                  <Pressable
                    style={styles.button}
                    onPress={() => {
                      setError("");
                      void navigate(currentPath.current).catch((e) =>
                        setError(e.message),
                      );
                    }}
                  >
                    <Text style={styles.buttonText}>再試行</Text>
                  </Pressable>
                </>
              )}
            </View>
          </ImageBackground>
        ) : (
          <WebView
            ref={web}
            applicationNameForUserAgent="MangumiNative/1"
            source={source}
            style={styles.web}
            originWhitelist={[origin]}
            onMessage={onMessage}
            injectedJavaScriptBeforeContentLoaded={`window.MangumiNative=${JSON.stringify({ version: 1, platform: Platform.OS, nonce })};true;`}
            injectedJavaScript={`window.MangumiNative=${JSON.stringify({ version: 1, platform: Platform.OS, nonce })};window.dispatchEvent(new Event('mangumi-native-ready'));true;`}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            thirdPartyCookiesEnabled={false}
            cacheEnabled={false}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            sharedCookiesEnabled
            allowsBackForwardNavigationGestures
            allowsLinkPreview={false}
            onShouldStartLoadWithRequest={(request) => {
              try {
                if (request.url === "about:blank") return true;
                if (new URL(request.url).origin === origin) return true;
                external(request.url);
                return false;
              } catch {
                return false;
              }
            }}
            onOpenWindow={(event) => external(event.nativeEvent.targetUrl)}
            onError={(event) => setError(event.nativeEvent.description)}
            onContentProcessDidTerminate={() => {
              void navigate(currentPath.current).catch((e) =>
                setError(e.message),
              );
            }}
            onNavigationStateChange={(state) => {
              setCanGoBack(state.canGoBack);
              if (
                state.url.startsWith(origin) &&
                !state.url.includes("/api/native/")
              )
                currentPath.current = localDestination(state.url, origin);
            }}
          />
        )}
        {!!voiceState.active && (
          <View style={styles.player}>
            <Text style={styles.text}>
              {voiceState.error ||
                (voiceState.muted ? "音声ルームを聴いています" : "マイク ON")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void voice.current?.leave();
              }}
            >
              <Text style={styles.gold}>退出</Text>
            </Pressable>
          </View>
        )}
        <Modal
          visible={!!paywall}
          transparent
          animationType="slide"
          onRequestClose={() => paywall?.cancel()}
        >
          <View style={styles.modal}>
            <ScrollView style={styles.card} contentContainerStyle={{ gap: 16 }}>
              <Text style={styles.title}>
                {paywall?.request.kind === "tip"
                  ? "コインでマン組を応援"
                  : "プランに参加"}
              </Text>
              <Text style={styles.text}>
                コイン残高：{paywall?.balance ?? 0}
              </Text>
              {paywall?.products.map((product) => (
                <View key={product.productId} style={styles.product}>
                  <Text style={styles.gold}>{product.title}</Text>
                  <Text style={styles.text}>
                    {product.kind === "coins"
                      ? `${product.credits}コイン`
                      : product.store.description}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.button}
                    onPress={() => {
                      void paywall.buy(product).catch((e) => warn(e.message));
                    }}
                  >
                    <Text style={styles.buttonText}>
                      {product.store.displayPrice}で購入
                    </Text>
                  </Pressable>
                </View>
              ))}
              <Text style={styles.text}>
                ストアの確認画面で金額・契約期間をご確認ください。購入の復元と解約はマイページから行えます。
              </Text>
              <Pressable onPress={() => paywall?.cancel()}>
                <Text style={styles.gold}>閉じる</Text>
              </Pressable>
            </ScrollView>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#110816" },
  web: { flex: 1, backgroundColor: "#110816" },
  splash: { flex: 1, justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: "#210b24",
    borderColor: "#ffd65c",
    borderWidth: 3,
    borderRadius: 18,
    padding: 22,
    maxHeight: "85%",
  },
  title: {
    color: "#ffe99a",
    fontSize: 28,
    fontWeight: "900",
    textShadowColor: "#ff2a5e",
    textShadowRadius: 8,
    marginBottom: 16,
  },
  text: { color: "#fff4df", fontSize: 16, lineHeight: 25 },
  gold: { color: "#ffd65c", fontWeight: "800", fontSize: 17 },
  button: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#ffd65c",
    marginTop: 12,
  },
  buttonText: {
    color: "#4e1228",
    fontWeight: "900",
    fontSize: 17,
    textAlign: "center",
  },
  player: {
    padding: 12,
    borderTopColor: "#ffcf57",
    borderTopWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  modal: {
    flex: 1,
    backgroundColor: "#000b",
    justifyContent: "center",
    padding: 20,
  },
  product: {
    gap: 6,
    borderBottomColor: "#9f672b",
    borderBottomWidth: 1,
    paddingBottom: 16,
  },
});
