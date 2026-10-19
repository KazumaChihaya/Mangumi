export const features = {
  "calendar.view": "配信予定",
  "notification.receive": "配信予定の通知",
  "story.view": "ストーリー",
  "dm.send": "公式DM",
  "dm.audio.send": "音声メッセージ",
  "voice.join": "音声ルーム",
  "voice.speak": "音声ルームへの登壇",
  "voice.create": "音声ルームの作成",
  "gacha.draw": "無料ガチャ",
  "tip.send": "投げ銭",
} as const;
export type Feature = keyof typeof features;
