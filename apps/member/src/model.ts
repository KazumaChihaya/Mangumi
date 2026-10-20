export type Schedule = {
  timezone?: string;
  startsAt?: string;
  endAt?: string;
  publishAt?: string;
  category?: string;
  important?: boolean;
  seriesId?: string;
  reminderMinutes?: number[];
  notify?: boolean;
  id: string;
  title: string;
  date: string;
  time: string;
  host: string;
  status: string;
  image: string;
  url: string;
  description: string;
  plan: string;
};
export type Message = {
  id: string;
  text: string;
  mine: boolean;
  audio?: boolean;
  failed?: boolean;
  time: string;
};
export type Audit = {
  actor?: string;
  ip?: string;
  id: string;
  action: string;
  target: string;
  before: string;
  after: string;
  reason: string;
  at: string;
};
export type Draw = {
  assetId?: string;
  kind?: "photo" | "voice" | "frame";
  id: string;
  title: string;
  rarity: string;
  image: string;
  at: string;
  version: string;
};
export type DemoState = {
  featureNames?: Record<string, string>;
  entitlements?: Record<string, boolean>;
  profile: {
    name: string;
    email: string;
    gender: string;
    publicGender: boolean;
    avatar: string;
    plan: string;
    verified: boolean;
    signedIn: boolean;
  };
  settings: {
    name: string;
    accent: string;
    maintenance: boolean;
    maintenanceText: string;
    notifyDM: boolean;
    notifyStory: boolean;
    notifySchedule: boolean;
    quiet: boolean;
    quietFrom: string;
    quietTo: string;
    recording: boolean;
    roomLimit: number;
    audioSeconds: number;
    retention: number;
    tipMax: number;
    dmPolicy: string;
    ngWords: string;
    phase: string;
  };
  schedules: Schedule[];
  stories: {
    id: string;
    title: string;
    image: string;
    status: string;
    plan: string;
    viewed: boolean;
    highlight: boolean;
  }[];
  rooms: {
    id: string;
    title: string;
    host: string;
    listeners: number;
    status: string;
    plan: string;
  }[];
  activeRoom: string | null;
  speaking: boolean;
  muted: boolean;
  messages: Message[];
  conversationMuted: boolean;
  blocked: boolean;
  members: {
    id: string;
    name: string;
    email: string;
    plan: string;
    status: string;
    joined: string;
  }[];
  plans: {
    id: string;
    name: string;
    price: number;
    features: string[];
    published: boolean;
  }[];
  tickets: number;
  draws: Draw[];
  probabilities: {
    title: string;
    rarity: string;
    weight: number;
    image: string;
  }[];
  probabilityVersion: string;
  probabilityVersions: {
    version: string;
    at: string;
    items: DemoState["probabilities"];
  }[];
  records: Record<string, Record<string, string>>;
  tips: {
    id: string;
    amount: number;
    message: string;
    recipient: string;
    status: string;
    at: string;
  }[];
  tipAmount: number;
  tipMessage: string;
  tipRecipient: string;
  paymentMethod: boolean;
  reports: {
    id: string;
    reason: string;
    target: string;
    status: string;
    assignee: string;
  }[];
  notices: {
    id: string;
    title: string;
    body: string;
    read: boolean;
    status: string;
  }[];
  campaigns: { id: string; title: string; status: string; count: number }[];
  sessions: { id: string; name: string; current: boolean; location: string }[];
  admins: {
    id: string;
    name: string;
    role: string;
    mfa: boolean;
    status: string;
  }[];
  audit: Audit[];
  reminders: string[];
  adminAuthenticated: boolean;
  support: { id: string; subject: string; body: string; status: string }[];
  gacha: {
    id?: string;
    title: string;
    status: string;
    start: string;
    end: string;
    description?: string;
    plan?: string;
    ticketCost?: number;
    maxBatch?: number;
    dailyTickets?: number;
    maxPerUser?: number;
  };
};
export const seed: DemoState = {
  probabilityVersion: "preview-v1",
  probabilityVersions: [],
  records: {},
  profile: {
    name: "マン組推し",
    email: "fan@example.test",
    gender: "回答しない",
    publicGender: false,
    avatar: "/assets/avatar.jpg",
    plan: "Free",
    verified: true,
    signedIn: true,
  },
  settings: {
    name: "まんぞうラブ",
    accent: "#ff285f",
    maintenance: false,
    maintenanceText: "ただいま準備中。もう少しだけ待っていてね！",
    notifyDM: true,
    notifyStory: true,
    notifySchedule: true,
    quiet: true,
    quietFrom: "23:00",
    quietTo: "08:00",
    recording: false,
    roomLimit: 300,
    audioSeconds: 300,
    retention: 30,
    tipMax: 10000,
    dmPolicy: "公式配信者のみ",
    ngWords: "迷惑行為, 個人情報",
    phase: "全機能プレビュー",
  },
  schedules: [
    {
      id: "s1",
      title: "今夜も全力！ジャグラー実戦LIVE",
      date: "2026-10-16",
      time: "20:00",
      host: "まんぞう",
      status: "公開",
      image: "/assets/thumb_1.jpg",
      url: "https://www.youtube.com/",
      description:
        "みんなと一緒に、最高の瞬間を。実戦の感想もチャットで教えてね！",
      plan: "Free",
    },
    {
      id: "s2",
      title: "週末のマン組トーク！",
      date: "2026-10-18",
      time: "21:00",
      host: "マン組",
      status: "公開",
      image: "/assets/thumb_2.jpg",
      url: "https://www.youtube.com/",
      description: "今週のハイライトを、みんなで振り返ろう。",
      plan: "Free",
    },
    {
      id: "s3",
      title: "新台チェック！朝からマン組",
      date: "2026-10-21",
      time: "10:00",
      host: "まんぞう",
      status: "予約",
      image: "/assets/thumb_3.jpg",
      url: "https://www.youtube.com/",
      description: "新しい台のワクワクを一緒に。",
      plan: "Free",
    },
  ],
  stories: [
    {
      id: "st1",
      title: "今日も会いにきてくれてありがとう！",
      image: "/assets/hero_story.jpg",
      status: "公開",
      plan: "Free",
      viewed: false,
      highlight: false,
    },
    {
      id: "st2",
      title: "撮影の裏側、こっそり公開。",
      image: "/assets/thumb_4.jpg",
      status: "公開",
      plan: "Free",
      viewed: false,
      highlight: true,
    },
    {
      id: "st3",
      title: "マン組のスペシャルオフショット",
      image: "/assets/thumb_5.jpg",
      status: "アーカイブ",
      plan: "LEGEND",
      viewed: true,
      highlight: true,
    },
  ],
  rooms: [
    {
      id: "r1",
      title: "実戦後のアフタートーク",
      host: "まんぞう",
      listeners: 128,
      status: "開催中",
      plan: "Free",
    },
    {
      id: "r2",
      title: "週末マン組ラジオ",
      host: "マン組",
      listeners: 0,
      status: "予定",
      plan: "Free",
    },
  ],
  activeRoom: null,
  speaking: false,
  muted: true,
  messages: [
    {
      id: "m1",
      text: "いつも応援ありがとう！今日の実戦、楽しんでもらえた？",
      mine: false,
      time: "19:42",
    },
    {
      id: "m2",
      text: "最高でした！次の配信も楽しみです❤️",
      mine: true,
      time: "19:44",
    },
    {
      id: "m3",
      text: "また一緒に盛り上がろう！",
      mine: false,
      audio: true,
      time: "19:45",
    },
  ],
  conversationMuted: false,
  blocked: false,
  members: Array.from({ length: 12 }, (_, i) => ({
    id: `member-${i + 1}`,
    name:
      [
        "マン組推し",
        "ペカりん",
        "スロット大好き",
        "みさき",
        "たくみ",
        "ゆうな",
      ][i % 6] + (i > 5 ? " II" : ""),
    email: `fan${i + 1}@example.test`,
    plan: ["Free", "GOLD", "LEGEND"][i % 3],
    status: i === 8 ? "停止中" : "有効",
    joined: `2026-10-${String(i + 1).padStart(2, "0")}`,
  })),
  plans: [
    {
      id: "free",
      name: "Free",
      price: 0,
      features: ["配信カレンダー", "通知", "公開ストーリー"],
      published: true,
    },
    {
      id: "gold",
      name: "GOLD",
      price: 980,
      features: ["Freeの全機能", "限定ストーリー", "限定スペース"],
      published: false,
    },
    {
      id: "legend",
      name: "LEGEND",
      price: 2980,
      features: [
        "GOLDの全機能",
        "スペシャルボイス",
        "限定プロフィールフレーム",
      ],
      published: false,
    },
  ],
  tickets: 5,
  draws: [],
  probabilities: [
    {
      title: "まんぞうスペシャルボイス",
      rarity: "SSR",
      weight: 5,
      image: "/assets/thumb_1.jpg",
    },
    {
      title: "マン組オフショット",
      rarity: "SR",
      weight: 25,
      image: "/assets/thumb_2.jpg",
    },
    {
      title: "応援プロフィールフレーム",
      rarity: "R",
      weight: 70,
      image: "/assets/thumb_3.jpg",
    },
  ],
  tips: [],
  tipAmount: 500,
  tipMessage: "",
  tipRecipient: "まんぞう",
  paymentMethod: false,
  reports: [
    {
      id: "rep1",
      reason: "不適切な発言",
      target: "会員ペカりん",
      status: "未対応",
      assignee: "未割当",
    },
    {
      id: "rep2",
      reason: "迷惑メッセージ",
      target: "DM #1204",
      status: "調査中",
      assignee: "モデレーター",
    },
  ],
  notices: [
    {
      id: "n1",
      title: "まんぞうラブへようこそ！",
      body: "マン組ともっと近くに。配信も、日常も、最高の瞬間も。一緒に楽しもう！",
      read: false,
      status: "公開",
    },
    {
      id: "n2",
      title: "今週の配信予定をチェック",
      body: "通知をONにして、始まる瞬間を逃さずに。",
      read: false,
      status: "公開",
    },
  ],
  campaigns: [
    { id: "c1", title: "週末配信リマインド", status: "予約", count: 0 },
    { id: "c2", title: "ようこそ！マン組", status: "送信済み", count: 1284 },
  ],
  sessions: [
    {
      id: "device1",
      name: "このブラウザ",
      current: true,
      location: "東京・日本",
    },
    {
      id: "device2",
      name: "iPhone / Safari",
      current: false,
      location: "東京・日本",
    },
  ],
  admins: [
    {
      id: "a1",
      name: "運営管理者",
      role: "スーパー管理者",
      mfa: true,
      status: "有効",
    },
    {
      id: "a2",
      name: "コンテンツ担当",
      role: "コンテンツ管理者",
      mfa: true,
      status: "有効",
    },
    {
      id: "a3",
      name: "サポート担当",
      role: "サポート担当",
      mfa: false,
      status: "招待中",
    },
  ],
  audit: [],
  reminders: ["1時間前", "10分前"],
  adminAuthenticated: false,
  support: [],
  gacha: {
    title: "マン組スペシャルガチャ",
    status: "公開",
    start: "2026-10-01",
    end: "2026-10-31",
  },
};
export function probabilityTotal(items: DemoState["probabilities"]) {
  return (
    items.reduce((sum, item) => sum + Math.round(item.weight * 100), 0) / 100
  );
}
export function selectPrize(items: DemoState["probabilities"], random: number) {
  if (
    probabilityTotal(items) !== 100 ||
    items.some((item) => item.weight < 0) ||
    !Number.isFinite(random) ||
    random < 0 ||
    random >= 1
  )
    throw new Error("提供割合を確認してください");
  let cursor = random * 100;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return items[items.length - 1];
}
export function validateTip(amount: number, max: number) {
  return Number.isInteger(amount) && amount >= 100 && amount <= max;
}
export function safeLink(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}
export const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
