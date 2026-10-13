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
  const { state, notify } = useStore();
  const screen = byId[id];
  const renderer = rendererFor(id);
  useEffect(() => {
    if (screen) document.title = `${screen.title} | ${state.settings.name}`;
  }, [id, state.settings.name]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
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
  return (
    <Shell screen={screen}>
      <Component key={id} screen={screen} />
    </Shell>
  );
}
