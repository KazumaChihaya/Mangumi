import React, { useState } from "react";
import { publicPath } from "./web-path";
import { useStore } from "./store";
import { useVoice } from "./live/Voice";
import { adminScreenAllowed } from "./live/Admin";
import { LivePwa } from "./live/Pwa";
import { api } from "./api";
import { Icon, RouteLink, SoundControls, Badge } from "./ui";
import {
  screens,
  sectionScreens,
  shortTitle,
  displayTitle,
  type Screen,
} from "./registry";
const nav = [
  { id: "U022", title: "ホーム", icon: "home" },
  { id: "U028", title: "予定", icon: "calendar" },
  { id: "U041", title: "スペース", icon: "mic" },
  { id: "U055", title: "DM", icon: "dm" },
  { id: "U088", title: "マイページ", icon: "user" },
] as const;
const categoryIcon = (name: string) =>
  /予定/.test(name)
    ? "calendar"
    : /音声/.test(name)
      ? "mic"
      : /DM|通報/.test(name)
        ? "dm"
        : /会員|管理者/.test(name)
          ? "user"
          : /通知/.test(name)
            ? "bell"
            : /ガチャ/.test(name)
              ? "ticket"
              : /投げ銭/.test(name)
                ? "heart"
                : /ブランド/.test(name)
                  ? "spark"
                  : "gear";
export function Shell({
  screen,
  children,
}: {
  screen: Screen;
  children: React.ReactNode;
}) {
  const { state, toast, reduced, update, refresh } = useStore();
  const voice = useVoice();
  const { live, role } = useStore();
  const [menu, setMenu] = useState(false);
  const admin = screen.area === "admin";
  const related = sectionScreens(screen);
  const sections = [
    ...new Set(
      screens
        .filter((item) => item.area === "admin")
        .map((item) => item.section),
    ),
  ];
  const adminActive = state.adminAuthenticated;
  return (
    <div
      className={`app-background ${admin ? "admin-background" : ""}`}
      style={{ "--accent": state.settings.accent } as React.CSSProperties}
    >
      <div className="cabinet-lights" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} style={{ "--lamp": index } as React.CSSProperties} />
        ))}
      </div>
      <a className="skip-link" href="#main-content">
        本文へ移動
      </a>
      <div className="preview-bar">
        <span>
          <i />
          {live ? "まんぞうラブ" : "UIプレビュー"}{" "}
          <small>{live ? "マン組 公式アプリ" : "サンプルデータ"}</small>
        </span>
        <div>
          {!live && <a href={publicPath("/screens")}>全画面</a>}
          {(!live ||
            admin ||
            ["super", "content", "moderator", "support", "finance"].includes(
              role,
            )) && (
            <RouteLink id={admin ? "U022" : "A008"}>
              {admin ? "アプリへ" : "管理画面"}
            </RouteLink>
          )}
        </div>
      </div>
      {admin ? (
        <>
          <div
            className="admin-marquee"
            role="img"
            aria-label="まんぞうラブ、マン組のコントロールルーム"
          >
            <span className="marquee-caption">MANZOU LOVE · CONTROL ROOM</span>
          </div>
          <div className="admin-shell">
            <aside className={`admin-sidebar ${menu ? "is-open" : ""}`}>
              <RouteLink id="A008" className="admin-brand">
                <span className="brand-title">
                  {state.settings.name}
                  <span>♥</span>
                </span>
                <small>CONTROL ROOM</small>
              </RouteLink>
              <Badge tone="pink">運営管理</Badge>
              <nav aria-label="管理メニュー">
                {sections.map((section) => {
                  const first = screens.find(
                    (item) => item.section === section && item.area === "admin",
                  )!;
                  const id = section === "ダッシュボード" ? "A008" : first.id;
                  if (
                    live &&
                    !adminScreenAllowed(
                      screens.find((item) => item.id === id)!,
                      role,
                    )
                  )
                    return null;
                  return (
                    <RouteLink
                      key={section}
                      id={id}
                      className={`admin-nav-item ${screen.section === section ? "active" : ""}`}
                    >
                      <Icon name={categoryIcon(section)} size={18} />
                      {section}
                    </RouteLink>
                  );
                })}
              </nav>
              <div className="sidebar-footer">
                <img src={publicPath("/assets/avatar.jpg")} alt="" />
                <div>
                  <strong>運営管理者</strong>
                  <small>
                    {live
                      ? adminActive
                        ? "認証済み"
                        : "ログインしてください"
                      : adminActive
                        ? "プレビューセッション"
                        : "ゲストプレビュー"}
                  </small>
                </div>
                {live && adminActive ? (
                  <button
                    className="icon-button"
                    aria-label="管理画面からログアウト"
                    onClick={async () => {
                      await api("/admin/auth/logout", {}, "POST", "admin");
                      await refresh();
                    }}
                  >
                    <Icon name="logout" size={17} />
                  </button>
                ) : (
                  <RouteLink id="A001">
                    <Icon name="logout" size={17} />
                  </RouteLink>
                )}
              </div>
            </aside>
            <div className="admin-main">
              <header className="admin-topbar">
                <button
                  className="icon-button mobile-menu"
                  aria-label="管理メニューを開閉"
                  onClick={() => setMenu(!menu)}
                >
                  <Icon name="menu" />
                </button>
                <span className="breadcrumbs">
                  CONTROL ROOM <span>／</span> {screen.section}
                </span>
                <SoundControls />
                <RouteLink id="A039" className="icon-button">
                  <Icon name="bell" />
                </RouteLink>
              </header>
              {menu && (
                <button
                  className="menu-backdrop"
                  aria-label="管理メニューを閉じる"
                  onClick={() => setMenu(false)}
                />
              )}
              <section className="admin-banner">
                <img src={publicPath("/assets/hero_admin.jpg")} alt="" />
                <div />
                <span className="eyebrow">MANZOU LOVE / MANAGEMENT</span>
                <h1>{shortTitle(screen.title)}</h1>
                <p>最高の体験を、ここから。</p>
                <span className="banner-star">✦</span>
              </section>
              <main
                id="main-content"
                className="admin-content"
                data-testid={screen.id}
              >
                {!live && (
                  <div
                    className="admin-section-tabs"
                    aria-label="関連する管理画面"
                  >
                    {related.map((item) => (
                      <RouteLink
                        key={item.id}
                        id={item.id}
                        className={item.id === screen.id ? "active" : ""}
                      >
                        {shortTitle(item.title)}
                      </RouteLink>
                    ))}
                  </div>
                )}
                <div className="screen-body">
                  {live && <LivePwa admin />}
                  {children}
                </div>
              </main>
              <footer className="admin-footer">
                <span>MANZOU LOVE CONTROL ROOM</span>
                <span>今日も最高の瞬間を。</span>
              </footer>
            </div>
          </div>
        </>
      ) : (
        <div className="member-surround">
          <div className="ambient-word" aria-hidden="true">
            LOVE
            <br />
            <span>777</span>
          </div>
          <div className="member-app">
            <header className="member-header">
              <div className="lamp-strip" aria-hidden="true">
                {Array.from({ length: 15 }, (_, index) => (
                  <i
                    key={index}
                    style={{ animationDelay: `${index * 0.16}s` }}
                  />
                ))}
              </div>
              <div className="member-masthead">
                <RouteLink id="U022" className="masthead-art">
                  <img
                    src={publicPath(
                      live && state.records.A076?.logo
                        ? state.records.A076.logo
                        : "/assets/mood-cabinet.png",
                    )}
                    alt={state.settings.name}
                    style={
                      live && state.records.A076?.logo
                        ? {
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            transform: "none",
                          }
                        : undefined
                    }
                  />
                </RouteLink>
                <div className="masthead-notify-mask" aria-hidden="true" />
                <RouteLink id="U025" className="notification-button">
                  <Icon name="bell" size={22} />
                  <b>{state.notices.filter((item) => !item.read).length}</b>
                </RouteLink>
                <div className="rank-plaque">
                  <span>FAN CLUB</span>
                  <strong>{state.profile.plan.toUpperCase()}</strong>
                  <small>いつもありがとう！</small>
                </div>
              </div>
              <div className="member-status">
                <span>マン組と、もっと近くに。</span>
                <Badge>{state.profile.plan.toUpperCase()} MEMBER</Badge>
              </div>
              <div className="cabinet-label">
                <span />
                MANZOU LOVE
                <span />
              </div>
              <div className="cabinet-controls">
                <span>NO SLOT NO LIFE</span>
                <SoundControls />
              </div>
            </header>
            <main
              id="main-content"
              className="member-content"
              data-testid={screen.id}
            >
              {live && <LivePwa />}
              {screen.id !== "U022" && (
                <div className="page-heading">
                  <button
                    className="icon-button"
                    aria-label="前の画面へ"
                    onClick={() => {
                      if (window.history.length > 1) window.history.back();
                      else window.location.assign(publicPath("/"));
                    }}
                  >
                    <Icon name="back" size={18} />
                  </button>
                  <div>
                    <span className="eyebrow">{screen.section}</span>
                    <h1>{displayTitle(screen)}</h1>
                  </div>
                  <span className="title-spark">✦</span>
                </div>
              )}
              <div className="screen-body">{children}</div>
              {!live && related.length > 1 && (
                <details className="related-pages">
                  <summary>関連ページ</summary>
                  <div>
                    {related
                      .filter((item) => item.id !== screen.id)
                      .map((item) => (
                        <RouteLink key={item.id} id={item.id}>
                          {shortTitle(item.title)}
                          <Icon name="chevron" size={13} />
                        </RouteLink>
                      ))}
                  </div>
                </details>
              )}
              <footer className="member-footer">
                <RouteLink id="U003">利用規約</RouteLink>
                <RouteLink id="U004">プライバシー</RouteLink>
                <RouteLink id="U101">ヘルプ</RouteLink>
                <small>© MANZOU LOVE</small>
              </footer>
            </main>
            {state.activeRoom && screen.id !== "U042" && (
              <div className="mini-player">
                <RouteLink id="U042">
                  <span className="live-dot" />
                  <div>
                    <strong>
                      {
                        state.rooms.find((room) => room.id === state.activeRoom)
                          ?.title
                      }
                    </strong>
                    <small>スペースに参加中</small>
                  </div>
                  <Icon name="mic" size={19} />
                </RouteLink>
                <button
                  aria-label="スペースから退出"
                  onClick={() =>
                    live
                      ? voice.leave()
                      : update((draft) => {
                          draft.activeRoom = null;
                        })
                  }
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            )}
            <nav className="bottom-nav" aria-label="メインメニュー">
              {nav.map((item) => {
                const active =
                  screen.section ===
                  screens.find((s) => s.id === item.id)?.section;
                return (
                  <RouteLink
                    id={item.id}
                    key={item.id}
                    className={active ? "active" : ""}
                  >
                    <Icon name={item.icon} size={22} />
                    <span>{item.title}</span>
                  </RouteLink>
                );
              })}
            </nav>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
      {!reduced && <div className="ambient-dust" aria-hidden="true" />}
    </div>
  );
}
