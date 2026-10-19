import React, { useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { screens, screenPath, type Screen } from "../registry";
import { useStore } from "../store";
import { yen } from "../model";
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
} from "../ui";
export type ConfigField = {
  name: string;
  label: string;
  value?: string | number;
  type?: string;
  options?: string[];
  multiline?: boolean;
  required?: boolean;
  help?: string;
  min?: number;
  max?: number;
};
export function ConfigForm({
  screen,
  fields,
  children,
  onSave,
  submit = "設定を保存",
  notice,
}: {
  screen: Screen;
  fields: ConfigField[];
  children?: React.ReactNode;
  onSave?: (values: Record<string, string>) => void;
  submit?: string;
  notice?: string;
}) {
  const { state, update, notify } = useStore();
  return (
    <Panel title={screen.title}>
      <Form
        submit={submit}
        onSubmit={async (values) => {
          await update(
            (d) => {
              d.records[screen.id] = values;
            },
            screen.title,
            screen.section,
            values.reason || "設定変更",
          );
          await onSave?.(values);
          notify("設定を保存しました");
        }}
      >
        <div className="field-grid">
          {fields.map((field) =>
            field.options ? (
              <Select
                key={field.name}
                name={field.name}
                label={field.label}
                options={field.options}
                value={
                  state.records[screen.id]?.[field.name] ??
                  String(field.value ?? "")
                }
              />
            ) : (
              <Field
                key={field.name}
                {...field}
                value={state.records[screen.id]?.[field.name] ?? field.value}
              />
            ),
          )}
        </div>
        {notice && <Notice>{notice}</Notice>}
        {children}
      </Form>
    </Panel>
  );
}
export function Chart({ gold = false }: { gold?: boolean }) {
  return (
    <>
      <div
        className={`metric-chart ${gold ? "gold" : ""}`}
        role="img"
        aria-label="サンプルの推移グラフ"
      >
        {Array.from({ length: 21 }, (_, index) => (
          <i
            key={index}
            style={{
              height: `${30 + ((index * 23) % 50) + index * 1.1}%`,
              animationDelay: `${index * 0.025}s`,
            }}
          />
        ))}
      </div>
      <div className="chart-labels">
        <span>10/1</span>
        <span>10/7</span>
        <span>10/13</span>
        <span>10/21</span>
      </div>
    </>
  );
}
export function AdminAuth({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const [error, setError] = useState("");
  const router = useRouter();
  const go = (id: string) => router.push(screenPath(id) as Href);
  if (screen.id === "A005")
    return (
      <Panel>
        <Empty
          icon="shield"
          title="この操作を行う権限がありません"
          text="担当ロールの権限をご確認ください。権限追加が必要な場合はスーパー管理者にご相談ください。"
          action={
            <Button id="A008" tone="gold">
              ダッシュボードへ
            </Button>
          }
        />
      </Panel>
    );
  if (screen.id === "A006")
    return (
      <Confirm
        title="管理操作の内容を確認"
        text="変更理由を記録して操作を確定します。プレビュー内の監査ログに残ります。"
        action="操作を確定"
        reason
        back="A008"
        onConfirm={async (reason) => {
          await update(
            (d) => {
              d.records.A006 = { reason, status: "確定" };
            },
            "管理操作確認",
            "プレビュー",
            reason,
          );
          notify("操作を記録しました");
          go("A094");
        }}
      />
    );
  if (screen.id === "A007")
    return (
      <Panel title="運営メニュー">
        <div className="feature-grid">
          {[
            ...new Set(
              screens.filter((s) => s.area === "admin").map((s) => s.section),
            ),
          ].map((section) => {
            const first = screens.find(
              (s) => s.area === "admin" && s.section === section,
            )!;
            return (
              <RouteLink
                id={section === "ダッシュボード" ? "A008" : first.id}
                key={section}
                className="feature-card"
              >
                <Icon name="gear" />
                <strong>{section}</strong>
                <small>管理画面を開く</small>
              </RouteLink>
            );
          })}
        </div>
      </Panel>
    );
  if (screen.id === "A004")
    return (
      <>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "name",
              label: "管理者表示名",
              value: state.admins[0].name,
              required: true,
            },
            {
              name: "role",
              label: "担当ロール",
              value: state.admins[0].role,
              options: [
                "スーパー管理者",
                "コンテンツ管理者",
                "モデレーター",
                "サポート担当",
                "経理担当",
              ],
            },
          ]}
          onSave={(v) =>
            update((d) => {
              d.admins[0].name = v.name;
              d.admins[0].role = v.role;
            }, "管理者プロフィール変更")
          }
        />
        <Panel title="セッション">
          <Row
            title="このブラウザ"
            sub="UIプレビュー / 東京"
            end={<Badge>現在の端末</Badge>}
          />
          <Button
            tone="danger"
            onClick={async () => {
              await update((d) => {
                d.adminAuthenticated = false;
              });
              go("A001");
            }}
          >
            ログアウト
          </Button>
        </Panel>
      </>
    );
  if (screen.id === "A002")
    return (
      <Panel title="二要素認証">
        <Form
          submit="認証をプレビュー"
          onSubmit={async (v) => {
            if (!/^\d{6}$/.test(v.code)) {
              setError("6桁の数字を入力してください");
              return;
            }
            await update((d) => {
              d.adminAuthenticated = true;
            });
            notify("管理者セッションのプレビューを開始しました");
            go("A008");
          }}
        >
          <Field
            label="認証コード"
            name="code"
            placeholder="000000"
            required
            help="UIプレビューでは任意の6桁で確認できます。本番の認証機能ではありません。"
          />
          {error && <Notice tone="error">{error}</Notice>}
        </Form>
      </Panel>
    );
  if (screen.id === "A003")
    return (
      <Panel title="管理者パスワード再設定">
        <Form
          submit="再設定をプレビュー"
          onSubmit={() =>
            notify(
              "パスワード再設定の受付プレビューです。メールは送信されません",
            )
          }
        >
          <Field
            label="管理者メールアドレス"
            name="email"
            type="email"
            required
          />
          <Notice>
            登録済み管理者のみが再設定の対象です。本番のメール配信・認証サーバーは未接続です。
          </Notice>
        </Form>
      </Panel>
    );
  return (
    <Panel title="運営管理者ログイン">
      <Form submit="ログインフローを確認" onSubmit={() => go("A002")}>
        <Field
          label="管理者メールアドレス"
          name="email"
          type="email"
          required
          value="admin@example.test"
        />
        <Field label="パスワード" name="password" type="password" required />
        <Notice>
          管理者認証のUIプレビューです。パスワードは保存しません。一般会員と管理者の認証は本番APIで分離します。
        </Notice>
      </Form>
      <div className="rule" />
      <RouteLink id="A003" className="underlined">
        パスワードを忘れた方
      </RouteLink>
    </Panel>
  );
}
export function Dashboard({ screen }: { screen: Screen }) {
  const { state } = useStore();
  const [range, setRange] = useState("今月");
  const sales = state.tips
    .filter((t) => t.status === "テスト完了")
    .reduce((sum, tip) => sum + tip.amount, 0);
  return (
    <>
      <div className="toolbar">
        <div>
          <Badge tone="pink">OPERATIONS OVERVIEW</Badge>
          <p className="preview-note">
            サンプルデータとこのプレビューでの操作を集計しています。
          </p>
        </div>
        <label className="field">
          <select
            aria-label="集計期間"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {["今日", "今週", "今月", "全期間"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="metric-grid">
        <Metric
          label="会員数"
          value={state.members.length}
          change={`${range} / プレビュー`}
          icon="user"
        />
        <Metric
          label="未処理の通報"
          value={state.reports.filter((r) => r.status !== "対応済み").length}
          change="対応状況を確認"
          icon="shield"
        />
        <Metric
          label="開催中スペース"
          value={state.rooms.filter((r) => r.status === "開催中").length}
          change="マン組の交流を見守る"
          icon="mic"
        />
        <Metric
          label="テスト売上"
          value={yen(sales)}
          change="実際の売上ではありません"
          icon="heart"
        />
      </div>
      <div className="two-columns">
        <Panel title="会員の推移" action={<Badge tone="gray">サンプル</Badge>}>
          <Chart />
        </Panel>
        <Panel title="通知の反応" action={<Badge tone="gray">サンプル</Badge>}>
          <Chart gold />
        </Panel>
      </div>
      {screen.id === "A009" && (
        <Panel title="指標の定義">
          <Row
            title="会員数"
            sub="プレビュー内の会員テーブルに登録された会員の数"
            end={<Badge>{state.members.length}名</Badge>}
          />
          <Row
            title="通知許可率（本番の定義）"
            sub="ログイン済みアクティブ会員のうち、有効な通知購読を1つ以上持つ会員の割合"
            end={<Badge tone="gray">未接続</Badge>}
          />
          <Row
            title="テスト売上"
            sub="テスト完了の投げ銭合計。返金済みは除外"
            end={<Badge>{yen(sales)}</Badge>}
          />
        </Panel>
      )}
      {screen.id === "A010" && (
        <Panel title="プラン別会員数">
          <Table
            columns={["プラン", "会員数", "公開状態"]}
            rows={state.plans.map((p) => [
              p.name,
              state.members.filter((m) => m.plan === p.name).length,
              <Badge key={p.id} tone={p.published ? "green" : "gray"}>
                {p.published ? "公開" : "準備中"}
              </Badge>,
            ])}
          />
        </Panel>
      )}
      <div className="two-columns">
        <Panel
          title="次の配信"
          action={<RouteLink id="A025">予定を管理 ↗</RouteLink>}
        >
          {state.schedules.slice(0, 3).map((s) => (
            <Row
              key={s.id}
              title={s.title}
              sub={`${s.date} ${s.time}`}
              image={s.image}
              id="A027"
              item={s.id}
            />
          ))}
        </Panel>
        <Panel
          title="対応待ちの通報"
          action={<RouteLink id="A052">通報キュー ↗</RouteLink>}
        >
          {state.reports
            .filter((r) => r.status !== "対応済み")
            .map((r) => (
              <Row
                key={r.id}
                title={r.reason}
                sub={`${r.target} / ${r.assignee}`}
                id="A053"
                item={r.id}
              />
            ))}
        </Panel>
      </div>
    </>
  );
}
