import data from "./screens.json";
export type Screen = {
  id: string;
  area: string;
  section: string;
  title: string;
  kind: string;
  phase: string;
};
export const screens: Screen[] = data;
export const byId = Object.fromEntries(
  screens.map((screen) => [screen.id, screen]),
);
export const primaryPaths: Record<string, string> = {
  U022: "/",
  U028: "/calendar",
  U034: "/stories",
  U041: "/space",
  U055: "/dm",
  U065: "/support",
  U076: "/gacha",
  U088: "/me",
  A008: "/admin",
};
export function screenPath(id: string) {
  return primaryPaths[id] ?? (id.startsWith("A") ? `/admin/${id}` : `/u/${id}`);
}
export function sectionScreens(screen: Screen) {
  return screens.filter(
    (item) => item.area === screen.area && item.section === screen.section,
  );
}
export function shortTitle(title: string) {
  return title.replace(
    /（PC＋スマホ同一画像）|（iPhone・Androidを1画像に掲載）|（一体型モック）/g,
    "",
  );
}
const labels: Record<string, string> = {
  U001: "アプリをホーム画面に",
  U005: "PCにアプリを追加",
  U008: "インストール手順",
  U019: "会員登録",
  U022: "ホーム",
  U027: "ホーム",
  U035: "マン組ストーリー",
  U039: "ストーリー",
  U040: "また会いにきてね",
  U042: "マン組スペース",
  U047: "発言の申請",
  U048: "スペース",
  U054: "録音のご案内",
  U059: "声のメッセージ",
  U061: "メッセージの確認",
  U063: "安心して楽しもう",
  U065: "マン組を応援",
  U066: "支払方法・応援履歴",
  U068: "応援内容の確認",
  U069: "支払方法",
  U070: "本人認証",
  U071: "決済結果の確認",
  U072: "応援ありがとう！",
  U076: "マン組ガチャ",
  U080: "チケットの確認",
  U081: "MANZOU CHANCE",
  U082: "ガチャ結果",
  U083: "ガチャ結果",
  U085: "アイテムの詳細",
  U086: "ガチャ履歴",
  U087: "無料チケット",
  U088: "マイページ",
  U092: "プロフィール写真",
  U099: "ログアウト",
  U102: "退会について",
  U109: "参加中のスペース",
};
export function displayTitle(screen: Screen) {
  return labels[screen.id] ?? shortTitle(screen.title);
}
