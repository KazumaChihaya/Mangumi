import React, { useState } from "react";
import { publicPath } from "../web-path";
import { useLocalSearchParams } from "expo-router";
import type { Screen } from "../registry";
import { useStore } from "../store";
import { safeLink } from "../model";
import {
  Badge,
  Button,
  Confirm,
  Empty,
  Field,
  Form,
  Icon,
  Metric,
  Notice,
  Panel,
  RouteLink,
  Row,
  Select,
  Table,
  Toggle,
  downloadCSV,
} from "../ui";
import { Chart, ConfigForm } from "./Common";
import { CalendarPage } from "../member/Calendar";
export function AssetUpload({
  value,
  onChange,
  label = "画像をアップロード",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const [error, setError] = useState("");
  return (
    <div className="upload-box">
      {value && <img src={publicPath(value)} alt="素材プレビュー" />}
      <label className="field">
        <span>{label}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (
              !/^image\/(jpeg|png|webp)$/.test(file.type) ||
              file.size > 5 * 1024 * 1024
            ) {
              setError("JPEG・PNG・WebP形式で5MB以下の画像を選んでください");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              onChange(String(reader.result));
              setError("");
            };
            reader.readAsDataURL(file);
          }}
        />
      </label>
      <small className="preview-note">
        プレビューでは端末のセッション内に保存します。
      </small>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
export function SchedulesPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const selected = state.schedules.find((s) => s.id === item);
  const first = selected ?? state.schedules[0];
  const [image, setImage] = useState(first.image);
  if (screen.id === "A026")
    return (
      <Panel title="運営カレンダー">
        <CalendarPage screen={{ ...screen, id: "U028" }} admin />
      </Panel>
    );
  if (["A025", "A031"].includes(screen.id)) {
    const rows = state.schedules.filter((s) =>
      `${s.title} ${s.status} ${s.host}`.includes(query),
    );
    return (
      <>
        <div className="toolbar">
          <label className="search-box">
            <Icon name="search" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="配信タイトル・状態で検索"
              aria-label="配信予定を検索"
            />
          </label>
          <div className="button-row">
            <Button id="A027" icon="plus">
              新規配信予定
            </Button>
            <Button
              tone="ghost"
              icon="download"
              onClick={() =>
                downloadCSV(
                  "schedules.csv",
                  ["ID", "タイトル", "日付", "開始時刻", "配信者", "状態"],
                  rows.map((s) => [
                    s.id,
                    s.title,
                    s.date,
                    s.time,
                    s.host,
                    s.status,
                  ]),
                )
              }
            >
              CSV出力
            </Button>
          </div>
        </div>
        <Panel title={`配信予定 / ${rows.length}件`}>
          <Table
            columns={["タイトル", "日付", "時刻", "配信者", "公開状態", "編集"]}
            rows={rows.map((s) => [
              s.title,
              s.date,
              s.time,
              s.host,
              <Badge key="status" tone={s.status === "公開" ? "green" : "gray"}>
                {s.status}
              </Badge>,
              <RouteLink
                key="edit"
                id="A027"
                item={s.id}
                className="button ghost small"
              >
                編集
              </RouteLink>,
            ])}
          />
        </Panel>
      </>
    );
  }
  if (screen.id === "A027")
    return (
      <Panel title={selected ? "配信予定を編集" : "配信予定を新規登録"}>
        <Form
          onSubmit={(v) => {
            const link = safeLink(v.url);
            if (!link) {
              setError("配信URLはHTTPSの正しいURLを入力してください");
              return;
            }
            update(
              (d) => {
                const entry = {
                  id: selected?.id ?? crypto.randomUUID(),
                  title: v.title,
                  date: v.date,
                  time: v.time,
                  host: v.host,
                  status: v.status,
                  image,
                  url: link,
                  description: v.description,
                  plan: v.plan,
                };
                const index = d.schedules.findIndex((s) => s.id === entry.id);
                if (index >= 0) d.schedules[index] = entry;
                else d.schedules.push(entry);
              },
              selected ? "配信予定編集" : "配信予定作成",
              v.title,
            );
            notify("配信予定を保存しました。利用者画面に反映されます");
          }}
        >
          <div className="field-grid">
            <Field
              name="title"
              label="配信タイトル"
              value={selected?.title}
              required
            />
            <Field
              name="host"
              label="配信者"
              value={selected?.host ?? "まんぞう"}
              required
            />
            <Field
              name="date"
              label="配信日（日本時間）"
              type="date"
              value={selected?.date ?? "2026-10-16"}
              required
            />
            <Field
              name="time"
              label="開始時刻"
              type="time"
              value={selected?.time ?? "20:00"}
              required
            />
            <Field
              name="url"
              label="配信先URL"
              type="url"
              value={selected?.url ?? "https://www.youtube.com/"}
              required
            />
            <Select
              name="status"
              label="公開状態"
              options={["下書き", "予約", "公開", "中止", "延期", "終了"]}
              value={selected?.status ?? "下書き"}
            />
            <Select
              name="plan"
              label="対象プラン"
              options={state.plans.map((p) => p.name)}
              value={selected?.plan ?? "Free"}
            />
            <Field
              name="description"
              label="説明"
              value={selected?.description}
              multiline
            />
          </div>
          <AssetUpload
            value={image}
            onChange={setImage}
            label="配信サムネイル"
          />
          {error && <Notice tone="error">{error}</Notice>}
        </Form>
      </Panel>
    );
  if (screen.id === "A028")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "schedule",
            label: "元となる配信",
            options: state.schedules.map((s) => s.title),
          },
          { name: "repeat", label: "繰り返し", options: ["毎週", "隔週"] },
          {
            name: "count",
            label: "追加する回数",
            type: "number",
            value: 3,
            min: 1,
            max: 12,
          },
          {
            name: "exception",
            label: "個別回の変更方針",
            options: ["個別回の変更を優先"],
          },
        ]}
        onSave={(v) => {
          const base = state.schedules.find((s) => s.title === v.schedule)!;
          update(
            (d) => {
              for (let i = 1; i <= Number(v.count); i++) {
                const date = new Date(`${base.date}T12:00:00Z`);
                date.setUTCDate(
                  date.getUTCDate() + i * (v.repeat === "毎週" ? 7 : 14),
                );
                d.schedules.push({
                  ...base,
                  id: crypto.randomUUID(),
                  date: date.toISOString().slice(0, 10),
                  status: "予約",
                });
              }
            },
            "繰り返し配信作成",
            base.title,
          );
        }}
      />
    );
  if (screen.id === "A029")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "schedule",
            label: "配信",
            options: state.schedules.map((s) => s.title),
          },
          {
            name: "status",
            label: "変更後の状態",
            options: ["公開", "予約", "下書き", "中止", "延期", "終了"],
          },
          { name: "publish", label: "予約公開日時", type: "datetime-local" },
          { name: "reason", label: "変更理由", required: true },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              d.schedules.find((s) => s.title === v.schedule)!.status =
                v.status;
            },
            "配信公開状態変更",
            v.schedule,
            v.reason,
          )
        }
      />
    );
  return (
    <Confirm
      title="予定変更のお知らせを送りますか？"
      text={`${first.title}の変更案内をプレビューのお知らせ一覧に追加します。Pushの実配信は行いません。`}
      action="変更のお知らせを作成"
      reason
      back="A025"
      onConfirm={(reason) => {
        update(
          (d) => {
            d.notices.unshift({
              id: crypto.randomUUID(),
              title: `配信予定変更：${first.title}`,
              body: reason,
              read: false,
              status: "公開",
            });
          },
          "配信変更通知",
          first.title,
          reason,
        );
        notify("利用者向けお知らせを作成しました");
      }}
    />
  );
}
export function NotificationsPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const campaign =
    state.campaigns.find((c) => c.id === item) ?? state.campaigns[0];
  if (screen.id === "A032")
    return (
      <>
        <div className="toolbar">
          <Notice>
            即時配信と予約配信を管理します。現在はプレビュー内の反映です。
          </Notice>
          <Button id="A033" icon="plus">
            新しいお知らせ
          </Button>
        </div>
        <Panel title="通知キャンペーン">
          <Table
            columns={["タイトル", "状態", "配信対象数", "操作"]}
            rows={state.campaigns.map((c) => [
              c.title,
              <Badge
                key="status"
                tone={c.status === "送信済み" ? "green" : "gold"}
              >
                {c.status}
              </Badge>,
              c.count,
              <RouteLink
                key="detail"
                id="A038"
                item={c.id}
                className="button ghost small"
              >
                結果を確認
              </RouteLink>,
            ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A033")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          { name: "title", label: "タイトル", required: true },
          { name: "body", label: "本文", multiline: true, required: true },
          {
            name: "type",
            label: "通知種別",
            options: ["運営通知", "配信予定", "ストーリー", "スペース"],
          },
          {
            name: "status",
            label: "公開状態",
            options: ["下書き", "公開", "予約"],
          },
          { name: "at", label: "配信日時", type: "datetime-local" },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              const id = crypto.randomUUID();
              d.campaigns.unshift({
                id,
                title: v.title,
                status: v.status,
                count: 0,
              });
              d.notices.unshift({
                id,
                title: v.title,
                body: v.body,
                read: false,
                status: v.status,
              });
            },
            "通知作成",
            v.title,
          )
        }
      />
    );
  if (screen.id === "A034")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "template",
            label: "テンプレート名",
            value: "配信開始リマインダー",
            required: true,
          },
          {
            name: "title",
            label: "件名",
            value: "{{配信タイトル}} がもうすぐ始まる！",
            required: true,
          },
          {
            name: "body",
            label: "本文",
            value:
              "{{開始時刻}}からマン組の配信が始まります。みんなで楽しもう！",
            multiline: true,
          },
          { name: "url", label: "遷移先", value: "/calendar" },
        ]}
        notice="利用できる差し込み項目：配信タイトル・開始時刻・会員名。"
      />
    );
  if (screen.id === "A035") {
    const selectedPlan = state.records.A035?.plan ?? "すべて";
    const count = state.members.filter(
      (m) => selectedPlan === "すべて" || m.plan === selectedPlan,
    ).length;
    return (
      <>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "plan",
              label: "対象プラン",
              options: ["すべて", ...state.plans.map((p) => p.name)],
            },
            {
              name: "status",
              label: "会員状態",
              options: ["有効な会員", "すべて"],
            },
            {
              name: "permission",
              label: "通知許可",
              options: ["許可済みのみ", "すべて"],
            },
            {
              name: "lastLogin",
              label: "最終ログイン",
              options: ["条件なし", "7日以内", "30日以内"],
            },
          ]}
        />
        <Panel title="対象候補">
          <Metric label="プランに一致する会員" value={count} icon="user" />
          <Notice>
            端末の通知許可と最終ログインの絞り込みは、本番の購読データ接続後に行います。
          </Notice>
        </Panel>
      </>
    );
  }
  if (screen.id === "A036")
    return (
      <Panel className="confirmation">
        <Empty
          icon="bell"
          title="通知をテストプレビュー"
          text={campaign.title}
        />
        <Button
          className="full"
          onClick={() => {
            update(
              (d) => {
                d.notices.unshift({
                  id: crypto.randomUUID(),
                  title: `[TEST] ${campaign.title}`,
                  body: "配信前の確認用通知です。UIプレビューにのみ表示します。",
                  read: false,
                  status: "公開",
                });
              },
              "通知テスト",
              campaign.title,
            );
            notify("通知センターにテスト表示を追加しました", "notify");
          }}
        >
          プレビューの通知センターに追加
        </Button>
        <Button id="U025" className="full" tone="ghost">
          通知センターを開く
        </Button>
      </Panel>
    );
  if (screen.id === "A037")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "campaign",
            label: "キャンペーン",
            options: state.campaigns.map((c) => c.title),
          },
          { name: "send", label: "配信方法", options: ["即時", "予約"] },
          { name: "at", label: "予約日時", type: "datetime-local" },
          { name: "reason", label: "配信確認メモ", required: true },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              const entry = d.campaigns.find((c) => c.title === v.campaign)!;
              entry.status = v.send === "即時" ? "テスト配信済み" : "予約";
              entry.count =
                v.send === "即時"
                  ? d.members.filter((m) => m.status === "有効").length
                  : 0;
              const notice = d.notices.find((n) => n.id === entry.id);
              if (notice) notice.status = v.send === "即時" ? "公開" : "予約";
            },
            "通知配信プレビュー",
            v.campaign,
            v.reason,
          )
        }
        notice="Pushの実送信は行いません。対象者数と公開状態の確認用です。"
      />
    );
  if (screen.id === "A038")
    return (
      <>
        <div className="metric-grid">
          <Metric
            label="対象数（サンプル）"
            value={campaign.count}
            icon="user"
          />
          <Metric label="配信状態" value={campaign.status} icon="bell" />
          <Metric label="実送達データ" value="未接続" icon="shield" />
          <Metric label="クリック計測" value="未接続" icon="star" />
        </div>
        <Panel title="配信結果">
          <Table
            columns={["キャンペーン", "状態", "対象数", "送達・失敗理由"]}
            rows={state.campaigns.map((c) => [
              c.title,
              c.status,
              c.count,
              "Push配信サービス未接続",
            ])}
          />
        </Panel>
      </>
    );
  return (
    <Panel title="登録端末と購読状態">
      <Table
        columns={["端末", "会員", "通知購読", "最終確認", "操作"]}
        rows={state.sessions.map((s) => [
          s.name,
          state.profile.name,
          <Badge key="status" tone="gray">
            未接続
          </Badge>,
          "サンプルデータ",
          <Button
            key="delete"
            tone="ghost"
            className="small"
            onClick={() => {
              update(
                (d) => {
                  d.sessions = d.sessions.filter((x) => x.id !== s.id);
                },
                "端末登録解除",
                s.name,
              );
              notify("端末の表示を解除しました");
            }}
          >
            解除
          </Button>,
        ])}
      />
      <Notice>
        購読情報の登録・期限切れの無効化はWeb Pushサーバー接続後に行います。
      </Notice>
    </Panel>
  );
}
export function StoriesAdmin({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const story = state.stories.find((s) => s.id === item) ?? state.stories[0];
  const [image, setImage] = useState(story.image);
  if (screen.id === "A040")
    return (
      <>
        <div className="toolbar">
          <span className="eyebrow">MANZOU STORIES</span>
          <Button id="A041" icon="plus">
            新しいストーリー
          </Button>
        </div>
        <Panel title="ストーリー一覧">
          <Table
            columns={["投稿", "対象プラン", "公開状態", "ハイライト", "操作"]}
            rows={state.stories.map((s) => [
              s.title,
              s.plan,
              <Badge key="status">{s.status}</Badge>,
              s.highlight ? "登録済み" : "未登録",
              <RouteLink
                key="edit"
                id="A042"
                item={s.id}
                className="button ghost small"
              >
                編集
              </RouteLink>,
            ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A041")
    return (
      <Panel title="ストーリーを投稿">
        <Form
          submit="下書きを作成"
          onSubmit={(v) => {
            update(
              (d) => {
                d.stories.unshift({
                  id: crypto.randomUUID(),
                  title: v.title,
                  image,
                  status: "下書き",
                  plan: v.plan,
                  viewed: false,
                  highlight: false,
                });
              },
              "ストーリー作成",
              v.title,
            );
            notify("ストーリーの下書きを作成しました");
          }}
        >
          <AssetUpload value={image} onChange={setImage} />
          <Field label="ストーリー本文" name="title" multiline required />
          <Select
            label="対象プラン"
            name="plan"
            options={state.plans.map((p) => p.name)}
          />
          <Notice>
            動画はアップロードAPIとトランスコード接続後に扱います。現在は画像の投稿プレビューです。
          </Notice>
        </Form>
      </Panel>
    );
  if (screen.id === "A042")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "title",
            label: "対象ストーリー",
            options: state.stories.map((s) => s.title),
            value: story.title,
          },
          {
            name: "plan",
            label: "対象プラン",
            options: state.plans.map((p) => p.name),
            value: story.plan,
          },
          {
            name: "status",
            label: "公開状態",
            options: ["下書き", "予約", "公開", "アーカイブ"],
            value: story.status,
          },
          { name: "start", label: "公開日時", type: "datetime-local" },
          { name: "end", label: "終了日時", type: "datetime-local" },
          {
            name: "notify",
            label: "公開通知",
            options: ["送信する", "送信しない"],
          },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              const entry = d.stories.find((s) => s.title === v.title)!;
              entry.plan = v.plan;
              entry.status = v.status;
            },
            "ストーリー公開設定",
            v.title,
          )
        }
      />
    );
  if (screen.id === "A043")
    return (
      <Panel title="アーカイブ・ハイライト">
        {state.stories.map((s) => (
          <Panel key={s.id} title={s.title}>
            <Toggle
              label="ハイライトとして公開"
              checked={s.highlight}
              onChange={(v) =>
                update(
                  (d) => {
                    d.stories.find((x) => x.id === s.id)!.highlight = v;
                  },
                  "ハイライト変更",
                  s.title,
                )
              }
            />
            <div className="button-row">
              <Button
                tone="ghost"
                onClick={() => {
                  update(
                    (d) => {
                      d.stories.find((x) => x.id === s.id)!.status =
                        "アーカイブ";
                    },
                    "ストーリーアーカイブ",
                    s.title,
                  );
                  notify("アーカイブへ移動しました");
                }}
              >
                アーカイブへ
              </Button>
              <Button
                tone="gold"
                onClick={() => {
                  update(
                    (d) => {
                      d.stories.find((x) => x.id === s.id)!.status = "公開";
                    },
                    "ストーリー再公開",
                    s.title,
                  );
                  notify("再公開しました");
                }}
              >
                再公開
              </Button>
            </div>
          </Panel>
        ))}
      </Panel>
    );
  return (
    <>
      <div className="metric-grid">
        <Metric
          label="公開ストーリー"
          value={state.stories.filter((s) => s.status === "公開").length}
        />
        <Metric
          label="このプレビューの既読数"
          value={state.stories.filter((s) => s.viewed).length}
        />
        <Metric
          label="ハイライト"
          value={state.stories.filter((s) => s.highlight).length}
        />
        <Metric label="全体の実閲覧数" value="未接続" />
      </div>
      <Panel title="閲覧状況（匿名集計）">
        <Table
          columns={["投稿", "プレビュー閲覧", "状態"]}
          rows={state.stories.map((s) => [s.title, s.viewed ? 1 : 0, s.status])}
        />
      </Panel>
    </>
  );
}
export function RoomsAdmin({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const room = state.rooms.find((r) => r.id === item) ?? state.rooms[0];
  if (screen.id === "A045")
    return (
      <>
        <div className="toolbar">
          <span className="eyebrow">VOICE ROOM OPERATIONS</span>
          <Button id="A046" icon="plus">
            ルームを作成
          </Button>
        </div>
        <Panel title="ルーム一覧">
          <Table
            columns={["ルーム", "ホスト", "状態", "参加人数", "管理"]}
            rows={state.rooms.map((r) => [
              r.title,
              r.host,
              <Badge
                key="status"
                tone={r.status === "開催中" ? "pink" : "gold"}
              >
                {r.status}
              </Badge>,
              r.listeners,
              <RouteLink
                key="detail"
                id="A047"
                item={r.id}
                className="button ghost small"
              >
                監視
              </RouteLink>,
            ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A046")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          { name: "title", label: "ルーム名", required: true },
          { name: "description", label: "説明", multiline: true },
          { name: "host", label: "ホスト", value: "まんぞう", required: true },
          { name: "status", label: "開始", options: ["予定", "開催中"] },
          { name: "start", label: "開始日時", type: "datetime-local" },
          {
            name: "plan",
            label: "対象プラン",
            options: state.plans.map((p) => p.name),
          },
          {
            name: "limit",
            label: "参加上限",
            type: "number",
            value: state.settings.roomLimit,
            min: 1,
          },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              d.rooms.push({
                id: crypto.randomUUID(),
                title: v.title,
                host: v.host,
                status: v.status,
                plan: v.plan,
                listeners: 0,
              });
              d.settings.roomLimit = Number(v.limit);
            },
            "音声ルーム登録",
            v.title,
          )
        }
      />
    );
  if (screen.id === "A047")
    return (
      <>
        <div className="metric-grid">
          <Metric label="ルームの状態" value={room.status} icon="mic" />
          <Metric
            label="リスナー（サンプル）"
            value={room.listeners}
            icon="user"
          />
          <Metric label="スピーカー（サンプル）" value={2} icon="mic" />
          <Metric label="音声サーバー" value="未接続" icon="shield" />
        </div>
        <Panel title={room.title}>
          <Chart />
          <Notice>
            参加人数と推移はデザイン確認用の値です。LiveKit接続後に実際の状態を取得します。
          </Notice>
          <div className="button-row">
            <Button id="A048" tone="gold">
              登壇者・終了を管理
            </Button>
            <Button id="A049" tone="ghost">
              BAN・通報対応
            </Button>
          </div>
        </Panel>
      </>
    );
  if (screen.id === "A048")
    return (
      <>
        <Panel title="登壇者の操作">
          {[room.host, "共同ホスト"].map((name) => (
            <Row
              key={name}
              title={name}
              sub="スピーカー"
              image="/assets/avatar.jpg"
              end={
                <Button
                  tone="ghost"
                  className="small"
                  onClick={() => {
                    update(
                      (d) => {
                        d.records[`mute-${name}`] = {
                          muted:
                            d.records[`mute-${name}`]?.muted === "true"
                              ? "false"
                              : "true",
                        };
                      },
                      "登壇者ミュート変更",
                      name,
                    );
                    notify("ミュート操作を記録しました");
                  }}
                >
                  {state.records[`mute-${name}`]?.muted === "true"
                    ? "ミュート解除"
                    : "ミュート"}
                </Button>
              }
            />
          ))}
        </Panel>
        <Confirm
          title="ルームを終了する"
          text={`${room.title}を終了状態に変更します。`}
          action="ルームを強制終了"
          reason
          back="A045"
          onConfirm={(reason) => {
            update(
              (d) => {
                d.rooms.find((r) => r.id === room.id)!.status = "終了";
                if (d.activeRoom === room.id) d.activeRoom = null;
              },
              "ルーム強制終了",
              room.title,
              reason,
            );
            notify("ルームを終了しました");
          }}
        />
      </>
    );
  if (screen.id === "A049")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          { name: "room", label: "ルーム", value: room.title },
          {
            name: "member",
            label: "対象会員",
            options: state.members.map((m) => m.name),
          },
          {
            name: "action",
            label: "措置",
            options: ["ルームから退出", "ルームBAN", "サービス全体の通報"],
          },
          { name: "reason", label: "理由", multiline: true, required: true },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              d.reports.unshift({
                id: crypto.randomUUID(),
                reason: `${v.action}：${v.reason}`,
                target: v.member,
                status: "対応済み",
                assignee: "運営管理者",
              });
            },
            v.action,
            v.member,
            v.reason,
          )
        }
      />
    );
  if (screen.id === "A050")
    return (
      <>
        <Panel title="録音の設定">
          <Toggle
            label="音声ルームの録音を有効化"
            description="入室前の告知・同意と保存期間の設定が必要です"
            checked={state.settings.recording}
            onChange={(v) =>
              update((d) => {
                d.settings.recording = v;
              }, "録音設定変更")
            }
          />
          <Notice>
            音声サーバーは未接続です。この設定は同意画面のプレビューに反映されます。
          </Notice>
        </Panel>
        <Panel title="録音アーカイブ">
          <Empty
            icon="mic"
            title="録音はありません"
            text="音声基盤を接続して録音を有効にすると、ここから管理できます。"
          />
        </Panel>
      </>
    );
  return (
    <>
      <div className="metric-grid">
        <Metric label="接続成功率" value="未計測" />
        <Metric label="パケットロス" value="未計測" />
        <Metric label="切断率" value="未計測" />
        <Metric label="LiveKit接続" value="未接続" />
      </div>
      <Panel title="音声品質の監視">
        <Chart />
        <Notice>
          グラフはサンプルです。実際の品質指標は音声サービス接続後に表示します。
        </Notice>
      </Panel>
      <Button id="A084" tone="ghost">
        音声サービスの接続設定
      </Button>
    </>
  );
}
