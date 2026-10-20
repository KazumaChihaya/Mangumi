import type { ConfigContext, ExpoConfig } from "expo/config";
export default ({ config }: ConfigContext): ExpoConfig => {
  const release = process.env.EAS_BUILD_PROFILE === "production";
  const identifier = process.env.MANGUMI_BUNDLE_ID ?? "dev.mangumi.app";
  const origin = process.env.EXPO_PUBLIC_APP_ORIGIN ?? "";
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "";
  if (
    release &&
    (!process.env.MANGUMI_BUNDLE_ID ||
      !origin.startsWith("https://") ||
      !projectId)
  )
    throw new Error(
      "Production builds require MANGUMI_BUNDLE_ID, HTTPS EXPO_PUBLIC_APP_ORIGIN and EXPO_PUBLIC_EAS_PROJECT_ID",
    );
  return {
    ...config,
    name: "まんぞうラブ",
    slug: "mangumi-native",
    version: "0.1.0",
    scheme: "mangumi",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    platforms: ["ios", "android"],
    icon: "./assets/icon.png",
    ios: {
      ...(origin.startsWith("https://")
        ? { associatedDomains: [`applinks:${new URL(origin).hostname}`] }
        : {}),
      bundleIdentifier: identifier,
      supportsTablet: true,
      infoPlist: {
        NSMicrophoneUsageDescription:
          "音声ルームでの発言とDMの音声メッセージ録音に使います。",
        NSPhotoLibraryUsageDescription:
          "プロフィール写真と公式投稿の画像を選ぶために使います。",
        UIBackgroundModes: ["audio", "remote-notification"],
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive.png",
        backgroundColor: "#170c1e",
      },
      ...(origin.startsWith("https://")
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                data: [
                  {
                    scheme: "https",
                    host: new URL(origin).hostname,
                    pathPrefix: "/u/",
                  },
                ],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ],
          }
        : {}),
      package: identifier,
      permissions: [
        "RECORD_AUDIO",
        "MODIFY_AUDIO_SETTINGS",
        "POST_NOTIFICATIONS",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_MICROPHONE",
        "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      ],
    },
    plugins: [
      "expo-secure-store",
      [
        "expo-notifications",
        { color: "#ffd65c", icon: "./assets/notification.png" },
      ],
      [
        "expo-audio",
        { microphonePermission: "DMの音声メッセージを録音します。" },
      ],
      "@livekit/react-native-expo-plugin",
      "@config-plugins/react-native-webrtc",
      ["expo-iap", { android: { store: "play" } }],
      "./plugins/with-voice-service",
    ],
    extra: { appOrigin: origin, ...(projectId ? { eas: { projectId } } : {}) },
  };
};
