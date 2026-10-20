import React, { useState, useEffect } from "react";
import { publicPath } from "../web-path";
import { useLocalSearchParams } from "expo-router";
import { useStore } from "../store";
import { safeLink, type Schedule } from "../model";
import { localSchedule, scheduleStart } from "../dates";
import type { Screen } from "../registry";
import { api } from "../api";
import { useResource } from "../live/hooks";
import {
  Badge,
  Empty,
  Button,
  Field,
  Icon,
  Notice,
  Panel,
  RouteLink,
  Row,
  Toggle,
} from "../ui";
export function CalendarPage({
  screen,
  admin = false,
}: {
  screen: Screen;
  admin?: boolean;
}) {
  const { state, update, notify, live } = useStore();
  const schedules =
    live && !admin ? state.schedules.map(localSchedule) : state.schedules;
  const { item } = useLocalSearchParams<{ item?: string }>();
  const [month, setMonth] = useState(live ? new Date().getMonth() : 9);
  const [year, setYear] = useState(live ? new Date().getFullYear() : 2026);
  const [day, setDay] = useState(live ? new Date().getDate() : 16);
  const base = schedules.find((s) => s.id === item) ?? schedules[0];
  const [detailItem, setDetailItem] = useState<Schedule>(),
    [detailError, setDetailError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDetailItem(undefined);
    setDetailError("");
    if (live && !admin && base && ["U029", "U033"].includes(screen.id))
      void api<Schedule>(`/schedules/${base.id}/view`, {})
        .then((value) => {
          if (!cancelled) setDetailItem(value);
        })
        .catch((e) => {
          if (!cancelled) setDetailError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [base?.id, screen.id, live, admin, attempt]);
  const selected =
    detailItem?.id === base?.id && detailItem
      ? localSchedule(detailItem)
      : base;
  const [selection, setSelection] = useState<number[]>();
  useEffect(() => setSelection(undefined), [selected?.id]);
  const reminder = useResource(
    live && screen.id === "U032" && selected
      ? `/schedules/${encodeURIComponent(selected.id)}/reminders`
      : undefined,
    0,
  );
  const defaults: Record<string, number> = {
    "24時間前": 1440,
    "1時間前": 60,
    "10分前": 10,
  };
  const timings: number[] =
    selection ??
    reminder.data?.minutes ??
    state.reminders.map((t) => defaults[t]).filter(Number.isFinite);
  if (["U029", "U032", "U033"].includes(screen.id) && !selected)
    return (
      <Panel>
        <Empty title="配信予定はありません" text="次回の配信をお楽しみに。" />
      </Panel>
    );
  if (screen.id === "U032")
    return (
      <>
        <Panel title="配信前のお知らせ">
          <p className="readable-text">{selected.title}</p>
          {reminder.error && <Notice>{reminder.error}</Notice>}
          {reminder.data?.enabled === false && (
            <Notice>この配信の自動通知は運営により停止されています。</Notice>
          )}
          {[...new Set([1440, 60, 10, ...timings])]
            .sort((a, b) => b - a)
            .map((minutes) => (
              <Toggle
                key={minutes}
                label={
                  minutes === 1440
                    ? "24時間前"
                    : minutes === 60
                      ? "1時間前"
                      : `${minutes}分前`
                }
                checked={timings.includes(minutes)}
                onChange={async (checked) => {
                  if (live) {
                    setSelection(
                      checked
                        ? [...timings, minutes]
                        : timings.filter((n) => n !== minutes),
                    );
                    return;
                  }
                  const time = Object.keys(defaults).find(
                    (t) => defaults[t] === minutes,
                  )!;
                  await update((d) => {
                    d.reminders = checked
                      ? [...d.reminders, time]
                      : d.reminders.filter((t) => t !== time);
                  });
                }}
              />
            ))}
          <Button
            className="full"
            onClick={async () => {
              try {
                if (live) {
                  await api(
                    `/schedules/${selected.id}/reminders`,
                    { minutes: timings },
                    "PUT",
                  );
                  await reminder.reload();
                  setSelection(undefined);
                }
                notify("リマインダーを保存しました");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            設定を保存
          </Button>
        </Panel>
        <Button id="U029" tone="ghost">
          配信詳細へ戻る
        </Button>
      </>
    );
  if (
    live &&
    !admin &&
    ["U029", "U033"].includes(screen.id) &&
    detailItem?.id !== base?.id
  )
    return (
      <Panel>
        <Notice>{detailError || "配信予定を確認しています…"}</Notice>
        {detailError && (
          <Button onClick={() => setAttempt((n) => n + 1)}>再試行</Button>
        )}
      </Panel>
    );
  if (["U029", "U033"].includes(screen.id))
    return (
      <>
        <img
          className="schedule-cover"
          src={publicPath(selected.image)}
          alt={selected.title}
        />
        <Panel>
          <div className="space-between">
            <Badge tone={selected.status === "中止" ? "pink" : "gold"}>
              {screen.id === "U033" ? "予定変更のご案内" : selected.status}
            </Badge>
            <span className="eyebrow">NEXT LIVE</span>
          </div>
          <h2 style={{ margin: "15px 0" }}>{selected.title}</h2>
          <dl className="detail-grid">
            <dt>配信日時</dt>
            <dd>
              {selected.date} {selected.time}（
              {live
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : "Asia/Tokyo"}
              ）
              {live && (
                <small>
                  元の日時：
                  {new Date(scheduleStart(selected)).toLocaleString("ja-JP", {
                    timeZone: selected.timezone ?? "Asia/Tokyo",
                  })}
                  （{selected.timezone ?? "Asia/Tokyo"}）
                </small>
              )}
            </dd>
            <dt>配信者</dt>
            <dd>{selected.host}</dd>
            <dt>対象プラン</dt>
            <dd>{selected.plan}</dd>
            <dt>配信先</dt>
            <dd>YouTube（外部サイト）</dd>
          </dl>
          <p className="readable-text">{selected.description}</p>
        </Panel>
        {screen.id === "U033" && (
          <Notice>
            配信日時やURLは変更される場合があります。現在の状態は「
            {selected.status}」です。最新のお知らせをご確認ください。
          </Notice>
        )}
        <div className="button-row">
          <Button id="U032" tone="ghost" icon="bell">
            通知を設定
          </Button>
          {safeLink(selected.url) && selected.status !== "中止" && (
            <a
              className="button primary"
              href={safeLink(selected.url)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="play" size={17} />
              YouTubeへ
            </a>
          )}
        </div>
        <Button id="U028" tone="ghost">
          カレンダーへ戻る
        </Button>
      </>
    );
  const shift = (direction: number) => {
    const date = new Date(year, month + direction, 1);
    setMonth(date.getMonth());
    setYear(date.getFullYear());
    setDay(1);
  };
  const monthDays = new Date(year, month + 1, 0).getDate();
  const startWeekDay = new Date(year, month, 1).getDay();
  const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const dayEvents = schedules.filter(
    (s) => s.date === dateString && s.status !== "下書き",
  );
  const events =
    screen.id === "U031"
      ? schedules
          .filter((s) => s.status !== "下書き")
          .sort((a, b) => scheduleStart(a) - scheduleStart(b))
      : dayEvents;
  return (
    <>
      <div className="tabs">
        {[
          ["U028", "月"],
          ["U030", "週"],
          ["U031", "一覧"],
        ].map(([id, label]) => (
          <RouteLink
            id={id}
            key={id}
            className={screen.id === id ? "active" : ""}
          >
            {label}
          </RouteLink>
        ))}
      </div>
      {screen.id !== "U031" && (
        <Panel title="配信カレンダー">
          <div className="calendar-top">
            <button
              className="icon-button"
              onClick={() => shift(-1)}
              aria-label="前の月"
            >
              <Icon name="back" size={16} />
            </button>
            <strong>
              {year}年 {month + 1}月
            </strong>
            <button
              className="icon-button"
              onClick={() => shift(1)}
              aria-label="次の月"
            >
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <div className="calendar-grid">
            {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
              <span key={w}>{w}</span>
            ))}
            {screen.id === "U028" &&
              Array.from({ length: startWeekDay }, (_, i) => (
                <span key={`empty-${i}`} />
              ))}
            {Array.from(
              { length: screen.id === "U030" ? 7 : monthDays },
              (_, i) => {
                const date =
                  screen.id === "U030"
                    ? new Date(
                        year,
                        month,
                        day - new Date(year, month, day).getDay() + i,
                      )
                    : new Date(year, month, i + 1);
                const d = date.getDate();
                const hasEvent = schedules.some(
                  (s) =>
                    s.date ===
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
                );
                return (
                  <button
                    key={i}
                    className={
                      d === day && date.getMonth() === month ? "selected" : ""
                    }
                    onClick={() => {
                      setYear(date.getFullYear());
                      setMonth(date.getMonth());
                      setDay(d);
                    }}
                    aria-label={`${date.getMonth() + 1}月${d}日`}
                    aria-pressed={d === day && date.getMonth() === month}
                  >
                    {d}
                    {hasEvent && <i />}
                  </button>
                );
              },
            )}
          </div>
        </Panel>
      )}
      <Panel
        title={
          screen.id === "U031"
            ? "これからの配信"
            : `${month + 1}月${day}日の配信`
        }
        action={
          <Badge>
            {live ? Intl.DateTimeFormat().resolvedOptions().timeZone : "JST"}
          </Badge>
        }
      >
        {events.length ? (
          events.map((event) => (
            <Row
              key={event.id}
              title={event.title}
              sub={`${event.date.slice(5)} ${event.time} · ${event.host}`}
              id={admin ? "A027" : "U029"}
              item={event.id}
              image={event.image}
              end={
                <Badge tone={event.status === "中止" ? "pink" : "gold"}>
                  {event.status}
                </Badge>
              }
            />
          ))
        ) : (
          <p className="readable-text">
            この日の配信予定はありません。別の日や一覧もチェックしてね。
          </p>
        )}
      </Panel>
      <Button id="U090" tone="ghost" icon="bell">
        通知設定
      </Button>
    </>
  );
}
