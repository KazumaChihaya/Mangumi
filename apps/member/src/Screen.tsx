import React, { useEffect } from "react";
import { byId } from "./registry";
import { Shell } from "./Shell";
import { useStore } from "./store";
import { HomePage, IntroPage, AuthPage, SystemPage } from "./member/General";
import { CalendarPage } from "./member/Calendar";
import { StoryPage, VoicePage, DMPage } from "./member/Social";
import { TipPage, GachaPage } from "./member/Commerce";
import { AccountPage } from "./member/Account";
import { AdminAuth, Dashboard } from "./admin/Common";
import { MembersPage, PlansPage } from "./admin/People";
import {
  SchedulesPage,
  NotificationsPage,
  StoriesAdmin,
  RoomsAdmin,
} from "./admin/Content";
import { ModerationPage, PaymentsAdmin, GachaAdmin } from "./admin/Operations";
import { BrandPage, SystemsPage, AdministratorsPage } from "./admin/Settings";
import { Button } from "./ui";
import { publicPath } from "./web-path";
import { liveMode } from "./api";
import { LiveAuth } from "./live/Auth";
import { Panel, Notice } from "./ui";
import { LiveDM } from "./live/Social";
import { LiveVoice } from "./live/Voice";
import { LiveAccount, LivePayments } from "./live/Account";
import { LiveAdmin, LiveBrand, adminScreenAllowed } from "./live/Admin";
import { LiveStoriesAdmin, LiveGachaAdmin } from "./live/Content";
import { LivePlansAdmin } from "./live/Plans";
import { LiveLegal } from "./live/Legal";
import { LiveStories } from "./live/Stories";
import { features, type Feature } from "./features";
import { LiveMembers } from "./live/Members";
export const renderers = [
  { area: "U", from: 1, to: 8, component: IntroPage },
  { area: "U", from: 9, to: 21, component: AuthPage },
  { area: "U", from: 22, to: 27, component: HomePage },
  { area: "U", from: 28, to: 33, component: CalendarPage },
  { area: "U", from: 34, to: 40, component: StoryPage },
  { area: "U", from: 41, to: 54, component: VoicePage },
  { area: "U", from: 55, to: 64, component: DMPage },
  { area: "U", from: 65, to: 75, component: TipPage },
  { area: "U", from: 76, to: 87, component: GachaPage },
  { area: "U", from: 88, to: 102, component: AccountPage },
  { area: "U", from: 103, to: 109, component: SystemPage },
  { area: "A", from: 1, to: 7, component: AdminAuth },
  { area: "A", from: 8, to: 10, component: Dashboard },
  { area: "A", from: 11, to: 17, component: MembersPage },
  { area: "A", from: 18, to: 24, component: PlansPage },
  { area: "A", from: 25, to: 31, component: SchedulesPage },
  { area: "A", from: 32, to: 39, component: NotificationsPage },
  { area: "A", from: 40, to: 44, component: StoriesAdmin },
  { area: "A", from: 45, to: 51, component: RoomsAdmin },
  { area: "A", from: 52, to: 59, component: ModerationPage },
  { area: "A", from: 60, to: 66, component: PaymentsAdmin },
  { area: "A", from: 67, to: 74, component: GachaAdmin },
  { area: "A", from: 75, to: 81, component: BrandPage },
  { area: "A", from: 82, to: 89, component: SystemsPage },
  { area: "A", from: 90, to: 95, component: AdministratorsPage },
];
export function rendererFor(id: string) {
  const number = Number(id.slice(1));
  return renderers.find(
    (entry) =>
      entry.area === id[0] && number >= entry.from && number <= entry.to,
  );
}
export default function ScreenPage({ id }: { id: string }) {
  const { state, notify, loading, connectionError, refresh, role } = useStore();
  const screen = byId[id];
  const renderer = rendererFor(id);
  useEffect(() => {
    if (screen) document.title = `${screen.title} | ${state.settings.name}`;
  }, [id, state.settings.name]);
  useEffect(() => {
    if (liveMode) void refresh().catch(() => {});
  }, [screen?.area]);
  useEffect(() => {
    if (liveMode) return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(publicPath("/sw.js"))
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              notify(
                "新しいバージョンがあります。更新案内から再読み込みできます",
                "notify",
              );
          });
        });
      })
      .catch(() => {});
  }, []);
  if (!screen || !renderer)
    return (
      <div className="not-found">
        <h1>ページが見つかりません</h1>
        <Button id="U022" tone="gold">
          ホームへ
        </Button>
      </div>
    );
  const Component = renderer.component;
  if (liveMode) {
    const number = Number(id.slice(1));
    if (loading || connectionError)
      return (
        <div className="app-background">
          <div className="member-app">
            <Panel>
              <h1>{loading ? "読み込み中…" : "接続できませんでした"}</h1>
              {connectionError && <Notice>{connectionError}</Notice>}
              <Button onClick={refresh}>再試行</Button>
            </Panel>
          </div>
        </div>
      );
    const authPage =
      (screen.area === "member" && number >= 9 && number <= 21) ||
      (screen.area === "admin" && number <= 5);
    const protectedPage =
      screen.area === "admin"
        ? !state.adminAuthenticated
        : number >= 22 &&
          number <= 102 &&
          (!state.profile.signedIn || !state.profile.verified);
    if (["U003", "U004"].includes(id))
      return (
        <Shell screen={screen}>
          <LiveLegal privacy={id === "U004"} />
        </Shell>
      );
    if (authPage || protectedPage) {
      const auth = authPage
        ? screen
        : byId[
            screen.area === "admin"
              ? "A001"
              : state.profile.signedIn
                ? "U014"
                : "U012"
          ];
      return (
        <Shell screen={screen}>
          <LiveAuth key={auth.id} screen={auth} />
        </Shell>
      );
    }
    if (screen.area === "admin" && !adminScreenAllowed(screen, role))
      return (
        <Shell screen={screen}>
          <LiveAuth screen={byId.A005} />
        </Shell>
      );
    const feature: Feature | undefined =
      screen.area !== "member"
        ? undefined
        : number >= 28 && number <= 33
          ? "calendar.view"
          : number >= 34 && number <= 40
            ? "story.view"
            : number >= 41 && number <= 54
              ? "voice.join"
              : number >= 55 && number <= 64
                ? "dm.send"
                : number >= 76 && number <= 83
                  ? "gacha.draw"
                  : undefined;
    if (feature && state.entitlements?.[feature] === false)
      return (
        <Shell screen={screen}>
          <Panel
            title={`${state.featureNames?.[feature] ?? features[feature]}の利用にはプランが必要です`}
          >
            <p>現在のプランでは、この機能を利用できません。</p>
            <Button id="U089">プランを確認する</Button>
          </Panel>
        </Shell>
      );
    if (
      screen.area === "member" &&
      number >= 22 &&
      number <= 87 &&
      state.settings.maintenance
    )
      return (
        <Shell screen={screen}>
          <Panel title="メンテナンス中です">
            <p>{state.settings.maintenanceText}</p>
            <Button onClick={refresh}>もう一度確認する</Button>
          </Panel>
        </Shell>
      );
    if (screen.area === "admin" && number >= 18 && number <= 24)
      return (
        <Shell screen={screen}>
          <LivePlansAdmin key={id} />
        </Shell>
      );
    if (screen.area === "admin" && number >= 11 && number <= 17)
      return (
        <Shell screen={screen}>
          <LiveMembers key={id} screen={screen} />
        </Shell>
      );
    if (screen.area === "admin" && number >= 40 && number <= 44)
      return (
        <Shell screen={screen}>
          <LiveStoriesAdmin key={id} />
        </Shell>
      );
    if (
      screen.area === "admin" &&
      number >= 67 &&
      number <= 74 &&
      number !== 73
    )
      return (
        <Shell screen={screen}>
          <LiveGachaAdmin key={id} />
        </Shell>
      );
    if (
      screen.area === "admin" &&
      ((number >= 8 && number <= 10) ||
        (number >= 32 && number <= 39) ||
        (number >= 45 && number <= 66) ||
        number === 73 ||
        (number >= 82 && number <= 95))
    )
      return (
        <Shell screen={screen}>
          <LiveAdmin key={id} screen={screen} />
        </Shell>
      );
    if (screen.area === "admin" && number >= 75 && number <= 81)
      return (
        <Shell screen={screen}>
          <LiveBrand key={id} />
        </Shell>
      );
    if (screen.area === "member" && number >= 34 && number <= 40)
      return (
        <Shell screen={screen}>
          <LiveStories key={id} screen={screen} />
        </Shell>
      );
    if (id[0] === "U" && number >= 55 && number <= 64)
      return (
        <Shell screen={screen}>
          <LiveDM key={id} screen={screen} />
        </Shell>
      );
    if (id[0] === "U" && number >= 41 && number <= 54)
      return (
        <Shell screen={screen}>
          <LiveVoice key={id} screen={screen} />
        </Shell>
      );
    if (id[0] === "U" && number >= 65 && number <= 75)
      return (
        <Shell screen={screen}>
          <LivePayments key={id} screen={screen} />
        </Shell>
      );
    if (
      [
        "U089",
        "U090",
        "U094",
        "U095",
        "U096",
        "U097",
        "U098",
        "U099",
        "U100",
        "U101",
        "U102",
      ].includes(id)
    )
      return (
        <Shell screen={screen}>
          <LiveAccount key={id} screen={screen} />
        </Shell>
      );
  }
  return (
    <Shell screen={screen}>
      <Component key={id} screen={screen} />
    </Shell>
  );
}
