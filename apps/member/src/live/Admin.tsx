import React, { useState } from "react";
import { api, upload } from "../api";
import { useStore } from "../store";
import type { Screen } from "../registry";
import {
  Button,
  Field,
  Form,
  Metric,
  Notice,
  Panel,
  Select,
  Table,
  downloadCSV,
} from "../ui";
import { yen } from "../model";
import { useResource } from "./hooks";
import { LiveVoice } from "./Voice";
import { LiveNotifications } from "./Notifications";
import { LiveRetention } from "./Retention";
import { LiveRevenue } from "./Revenue";
import { LiveInstallGuides } from "./InstallGuides";
import { LiveMonitoring, LiveAudit } from "./Monitoring";
import { LiveEmailTemplates } from "./EmailTemplates";

export function adminScreenAllowed(screen: Screen, role: string) {
  if (role === "super") return true;
  const number = Number(screen.id.slice(1));
  const allowed =
    number <= 10
      ? ["content", "moderator", "support", "finance"]
      : number <= 17
        ? ["moderator", "support"]
        : number <= 24
          ? []
          : number <= 44
            ? ["content"]
            : number <= 51
              ? ["content", "moderator"]
              : number <= 59
                ? ["moderator"]
                : number <= 66
                  ? ["finance"]
                  : number <= 81
                    ? ["content"]
                    : [];
  return allowed.includes(role);
}
export function LiveAdmin({ screen }: { screen: Screen }) {
  const { state, refresh, notify } = useStore();
  const number = Number(screen.id.slice(1));
  const analytics = useResource(number <= 10 ? "/admin/analytics" : undefined);
  const operations = useResource(
    number >= 82 && number <= 89 ? "/admin/operations" : undefined,
  );
  const jobs = useResource<any[]>(
    (number >= 32 && number <= 39) || number === 87 ? "/admin/jobs" : undefined,
  );
  const officials = useResource<any[]>(
    number >= 45 && number <= 51 ? "/officials" : undefined,
    0,
  );
  const [evidence, setEvidence] = useState<any>();
  const command = async (
    resource: string,
    id: string | undefined,
    after: unknown,
    reason: string,
  ) => {
    await api(
      "/commands",
      {
        changes: [{ resource, id, after }],
        action: screen.title.slice(0, 100),
        reason,
      },
      "POST",
      "admin",
      crypto.randomUUID(),
    );
    await refresh();
  };
  if (number === 85) return <LiveRetention />;
  if (number === 82) return <LiveEmailTemplates />;
  if (number === 89) return <LiveMonitoring />;
  if (number === 94 || number === 95) return <LiveAudit />;
  if ([60, 61, 65, 66].includes(number)) return <LiveRevenue />;
  if (number <= 10)
    return (
      <>
        <div className="metric-grid">
          <Metric
            label="会員数"
            value={String(analytics.data?.members ?? 0)}
            icon="user"
          />
          <Metric
            label="未対応の通報"
            value={String(analytics.data?.unresolvedReports ?? 0)}
            icon="shield"
          />
          <Metric
            label="開催中ルーム"
            value={String(analytics.data?.liveRooms ?? 0)}
            icon="mic"
          />
          <Metric
            label="売上（返金控除後・手数料控除前）"
            value={
              analytics.data?.revenue === null
                ? "権限なし"
                : yen(analytics.data?.revenue ?? 0)
            }
            icon="heart"
          />
        </div>
        <Panel title="通知と会員">
          <p>有効会員：{analytics.data?.verified ?? 0}人</p>
          <p>直近30日のアクティブ会員：{analytics.data?.active30Days ?? 0}人</p>
          <p>
            通知許可率：
            {((analytics.data?.notificationOptInRate ?? 0) * 100).toFixed(1)}%
          </p>
          {analytics.data?.definitions &&
            Object.entries(analytics.data.definitions).map(([key, value]) => (
              <Notice key={key}>{String(value)}</Notice>
            ))}
        </Panel>
      </>
    );
  if (number >= 32 && number <= 39) return <LiveNotifications />;
  if (number >= 45 && number <= 51)
    return (
      <>
        <Panel title="音声ルームを作成">
          <Form
            submit="ルームを保存"
            onSubmit={async (values) => {
              const host = officials.data?.find(
                (official) => official.id === values.host,
              );
              if (!host) throw new Error("公式配信者を登録してください");
              const entry = {
                id: crypto.randomUUID(),
                title: values.title,
                host: host.name,
                hostId: host.id,
                listeners: 0,
                status: values.status,
                plan: values.plan,
                maxMinutes: Number(values.maxMinutes),
                maxListeners: Number(values.maxListeners),
                maxSpeakers: Number(values.maxSpeakers),
                description: values.description,
                visibility: values.visibility,
                invited: values.invited.split(/[,\s]+/).filter(Boolean),
                reactions: values.reactions === "有効",
              };
              await command("rooms", entry.id, entry, "ルームを新規登録");
            }}
          >
            <Field name="title" label="ルーム名" required />
            <Field name="description" label="ルームの説明" multiline />
            <Field
              name="maxMinutes"
              label="最大時間（分）"
              type="number"
              min={1}
              max={1440}
              value={120}
              required
            />
            <Field
              name="maxListeners"
              label="最大参加者数"
              type="number"
              min={1}
              max={10000}
              value={state.settings.roomLimit}
              required
            />
            <Field
              name="maxSpeakers"
              label="最大登壇者数"
              type="number"
              min={1}
              max={50}
              value={8}
              required
            />
            <Select
              name="visibility"
              label="公開範囲"
              options={["public", "plan", "invite"]}
            />
            <Field name="invited" label="招待する会員ID（カンマ区切り）" />
            <Select
              name="reactions"
              label="リアクション"
              options={["有効", "無効"]}
            />
            <label className="field">
              <span>ホスト</span>
              <select name="host" required>
                {officials.data?.map((official) => (
                  <option key={official.id} value={official.id}>
                    {official.name}
                  </option>
                ))}
              </select>
            </label>
            <Select
              name="plan"
              label="対象プラン"
              options={state.plans.map((plan) => plan.name)}
            />
            <Select
              name="status"
              label="開催状態"
              options={["開催予定", "開催中", "終了"]}
            />
          </Form>
        </Panel>
        <LiveVoice screen={screen} />
      </>
    );
  if (number >= 52 && number <= 59)
    return (
      <>
        <Panel title="通報の調査">
          {state.reports.map((report) => (
            <Panel
              key={report.id}
              title={`${report.reason} · ${report.status}`}
            >
              <Form
                submit="証拠を確認する"
                onSubmit={async (values) => {
                  setEvidence(
                    await api(`/admin/reports/${report.id}/evidence`, {
                      reason: values.reason,
                    }),
                  );
                }}
              >
                <Field name="reason" label="閲覧目的" required />
              </Form>
              <Form
                submit="対応を確定"
                onSubmit={async (values) => {
                  await api(`/admin/reports/${report.id}/action`, {
                    action: values.action,
                    reason: values.reason,
                  });
                  await refresh();
                }}
              >
                <Select
                  name="action"
                  label="対応内容"
                  options={["warn", "suspend", "remove", "dismiss"]}
                />
                <Field name="reason" label="対応理由" multiline required />
              </Form>
            </Panel>
          ))}
          {evidence && (
            <Panel title="通報時点の証拠">
              {evidence.audioUrl && <audio controls src={evidence.audioUrl} />}
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(evidence.evidence, null, 2)}
              </pre>
            </Panel>
          )}
        </Panel>
      </>
    );
  if (number >= 60 && number <= 66)
    return (
      <>
        <Panel title="応援・決済の管理">
          <Table
            columns={["ID", "日時", "金額", "状態"]}
            rows={state.tips.map((tip) => [
              tip.id,
              new Date(tip.at).toLocaleString("ja-JP"),
              yen(tip.amount),
              tip.status,
            ])}
          />
          <Button
            onClick={() =>
              downloadCSV(
                "売上.csv",
                ["ID", "日時", "金額", "状態"],
                state.tips.map((tip) => [
                  tip.id,
                  tip.at,
                  tip.amount,
                  tip.status,
                ]),
              )
            }
          >
            CSVをダウンロード
          </Button>
        </Panel>
        <Panel title="返金">
          <Form
            submit="返金を実行"
            tone="danger"
            onSubmit={async (values) => {
              await api(
                "/admin/refunds",
                {
                  tipId: values.tipId,
                  amount: Number(values.amount),
                  reason: values.reason,
                  code: values.code,
                },
                "POST",
                "admin",
                crypto.randomUUID(),
              );
              await refresh();
              notify("返金を受け付けました");
            }}
          >
            <Field name="tipId" label="決済ID" required />
            <Field name="amount" label="返金額（円）" type="number" required />
            <Field name="reason" label="返金理由" multiline required />
            <Field name="code" label="認証アプリの新しい6桁コード" required />
            <label className="check-row">
              <input type="checkbox" required />
              対象の決済と金額を確認しました
            </label>
          </Form>
        </Panel>
      </>
    );
  if (number === 73)
    return (
      <Panel title="チケット・景品の補填">
        <Form
          submit="補填を実行"
          onSubmit={async (values) => {
            await api(
              "/admin/gacha/grant",
              {
                userId: values.userId,
                ...(values.tickets ? { tickets: Number(values.tickets) } : {}),
                ...(values.prize ? { prize: values.prize } : {}),
                reason: values.reason,
              },
              "POST",
              "admin",
              crypto.randomUUID(),
            );
            notify("補填を記録しました");
            await refresh();
          }}
        >
          <Field name="userId" label="対象会員ID" required />
          <Field name="tickets" label="付与するチケット数" type="number" />
          <label className="field">
            <span>付与する景品（任意）</span>
            <select name="prize">
              <option value="">景品を付与しない</option>
              {state.probabilities.map((prize) => (
                <option key={prize.title}>{prize.title}</option>
              ))}
            </select>
          </label>
          <Field name="reason" label="補填理由" multiline required />
        </Form>
      </Panel>
    );
  if (number >= 82 && number <= 89)
    return (
      <>
        <Panel title="サービス接続状態">
          {operations.error && <Notice>{operations.error}</Notice>}
          {operations.data && (
            <Table
              columns={["項目", "状態"]}
              rows={Object.entries(operations.data.providers).map(
                ([name, ready]) => [
                  (
                    {
                      database: "データ保存",
                      mail: "メール配信",
                      push: "プッシュ通知",
                      payments: "決済",
                      voice: "音声通信",
                    } as Record<string, string>
                  )[name],
                  ready ? "設定済み" : "未設定",
                ],
              )}
            />
          )}
          <Notice>
            外部サービスの認証情報はサーバーの秘密情報設定で管理します。
          </Notice>
        </Panel>
        <Panel title="運用設定">
          <Form
            onSubmit={async (values) => {
              await command(
                "settings",
                undefined,
                {
                  maintenance: values.maintenance === "メンテナンス中",
                  maintenanceText: values.maintenanceText,
                  ngWords: values.ngWords,
                  duplicateNicknames: values.duplicateNicknames === "許可",
                  dmAllowedHosts: values.dmAllowedHosts
                    .split(/[,\s]+/)
                    .filter(Boolean),
                  roomLimit: Number(values.roomLimit),
                  audioSeconds: Number(values.audioSeconds),
                  retention: Number(values.retention),
                  tipMax: Number(values.tipMax),
                  tipMin: Number(values.tipMin),
                  tipDaily: Number(values.tipDaily),
                  tipMonthly: Number(values.tipMonthly),
                  tipPresets: values.tipPresets
                    .split(/[,\s]+/)
                    .filter(Boolean)
                    .map(Number),
                  dmPolicy: values.dmPolicy,
                  billingEnabled: values.billing === "受付中",
                  adminSessionMinutes: Number(values.adminSessionMinutes || 30),
                  adminNetworks: values.adminNetworks
                    .split(/[,\s]+/)
                    .filter(Boolean),
                },
                values.reason,
              );
              await operations.reload();
            }}
          >
            <Select
              name="maintenance"
              label="公開状態"
              options={["通常公開", "メンテナンス中"]}
              value={state.settings.maintenance ? "メンテナンス中" : "通常公開"}
            />
            <Field
              name="maintenanceText"
              label="メンテナンス案内"
              value={state.settings.maintenanceText}
              multiline
            />
            <Field
              name="ngWords"
              label="禁止する言葉（カンマ区切り）"
              value={state.settings.ngWords}
            />
            <Select
              name="duplicateNicknames"
              label="ニックネームの重複"
              options={["許可", "不可"]}
              value={
                (state.settings as any).duplicateNicknames === false
                  ? "不可"
                  : "許可"
              }
            />
            <Field
              name="dmAllowedHosts"
              label="DMで許可するリンクのホスト（カンマ区切り、空欄はURL不可）"
              value={((state.settings as any).dmAllowedHosts ?? []).join(",")}
            />
            <Field
              name="adminSessionMinutes"
              label="管理セッションの有効時間（分）"
              type="number"
              min={5}
              max={1440}
              value={(state.settings as any).adminSessionMinutes ?? 30}
              required
            />
            <Field
              name="adminNetworks"
              label="管理画面の許可IP・CIDR（空欄は制限なし・1行に1件）"
              multiline
              value={((state.settings as any).adminNetworks ?? []).join("\n")}
            />
            <Field
              name="roomLimit"
              label="ルーム定員"
              type="number"
              value={state.settings.roomLimit}
              required
            />
            <Field
              name="audioSeconds"
              label="音声メッセージの上限秒数"
              type="number"
              value={state.settings.audioSeconds}
              required
            />
            <Field
              name="retention"
              label="保存期間（日）"
              type="number"
              value={state.settings.retention}
              required
            />
            <Field
              name="tipMax"
              label="応援金額の1回上限（円）"
              type="number"
              value={state.settings.tipMax}
              required
            />
            <Field
              name="tipMin"
              label="応援金額の最低額（円）"
              type="number"
              min={100}
              value={(state.settings as any).tipMin ?? 100}
              required
            />
            <Field
              name="tipDaily"
              label="1日の応援金額上限（円）"
              type="number"
              value={
                (state.settings as any).tipDaily ?? state.settings.tipMax * 5
              }
              required
            />
            <Field
              name="tipMonthly"
              label="1か月の応援金額上限（円）"
              type="number"
              value={
                (state.settings as any).tipMonthly ?? state.settings.tipMax * 20
              }
              required
            />
            <Field
              name="tipPresets"
              label="金額候補（円・カンマ区切り）"
              value={(
                (state.settings as any).tipPresets ?? [500, 1000, 3000]
              ).join(",")}
              required
            />
            <Select
              name="dmPolicy"
              label="DMの公開範囲"
              options={["公式配信者のみ", "不可"]}
              value={state.settings.dmPolicy}
            />
            <Select
              name="billing"
              label="有料決済"
              options={["停止中", "受付中"]}
              value={
                (state.settings as any).billingEnabled ? "受付中" : "停止中"
              }
            />
            <Field name="reason" label="変更理由" required />
          </Form>
        </Panel>
        {number === 87 && (
          <Panel title="失敗した処理の再試行">
            {jobs.data
              ?.filter((job) => job.state === "failed")
              .map((job) => (
                <Form
                  key={job.id}
                  submit={`${job.kind}を再試行`}
                  onSubmit={async (values) => {
                    await api(`/admin/jobs/${job.id}/retry`, {
                      reason: values.reason,
                    });
                    await jobs.reload();
                  }}
                >
                  <p>{job.id}</p>
                  <Field name="reason" label="再試行の理由" required />
                </Form>
              ))}
          </Panel>
        )}
      </>
    );
  return (
    <>
      <Panel title="管理者・公式配信者">
        <Button id="A094" tone="ghost">
          監査ログを確認
        </Button>
        <Table
          columns={["名前", "ロール", "二要素認証", "状態"]}
          rows={state.admins.map((admin) => [
            admin.name,
            admin.role,
            admin.mfa ? "登録済み" : "未登録",
            admin.status,
          ])}
        />
      </Panel>
      <Panel title="招待">
        <Form
          submit="招待メールを送る"
          onSubmit={async (values) => {
            await api("/admin/users", {
              name: values.name,
              email: values.email,
              role: values.role,
              reason: values.reason,
            });
            await refresh();
            notify("招待を受け付けました");
          }}
        >
          <Field name="name" label="表示名" required />
          <Field name="email" label="メールアドレス" type="email" required />
          <Select
            name="role"
            label="ロール"
            options={[
              "content",
              "moderator",
              "support",
              "finance",
              "super",
              "official",
            ]}
          />
          <Field name="reason" label="招待理由" required />
        </Form>
      </Panel>
      <Panel title="ロール変更">
        <Form
          submit="ロールを変更"
          onSubmit={async (values) => {
            await api(
              `/admin/users/${values.userId}/role`,
              { role: values.role, reason: values.reason },
              "PATCH",
            );
            await refresh();
          }}
        >
          <Field name="userId" label="対象アカウントID" required />
          <Select
            name="role"
            label="変更後のロール"
            options={[
              "member",
              "official",
              "content",
              "moderator",
              "support",
              "finance",
              "super",
            ]}
          />
          <Field name="reason" label="変更理由" required />
        </Form>
      </Panel>
    </>
  );
}
export function LiveBrand() {
  const { state, refresh, notify } = useStore();
  const current = useResource("/brand", 0);
  const versions = useResource<any[]>("/admin/brand/versions", 0);
  const [logo, setLogo] = useState("");
  const [icon, setIcon] = useState("");
  const [ogp, setOgp] = useState("");
  const [emailLogo, setEmailLogo] = useState("");
  const [installGuide, setInstallGuide] = useState("");
  const [notificationIcon, setNotificationIcon] = useState("");
  return (
    <>
      <Panel title="ブランド・公開設定">
        <Form
          submit="ブランド設定を保存"
          onSubmit={async (values) => {
            await api("/admin/brand", {
              values: {
                name: values.name,
                short: values.short,
                description: values.description,
                accent: values.accent,
                background: values.background,
                button: values.button,
                logoAlt: values.logoAlt,
                ...(notificationIcon || current.data?.notificationIcon
                  ? {
                      notificationIcon:
                        notificationIcon || current.data.notificationIcon,
                    }
                  : {}),
                ...(logo || current.data?.logo
                  ? { logo: logo || current.data.logo }
                  : {}),
                ...(icon || current.data?.icon
                  ? { icon: icon || current.data.icon }
                  : {}),
                ...(values.terms ? { terms: values.terms } : {}),
                ...(values.privacy ? { privacy: values.privacy } : {}),
                ...(values.contact ? { contact: values.contact } : {}),
                ...(values.commerce ? { commerce: values.commerce } : {}),
                ...(ogp || current.data?.ogp
                  ? { ogp: ogp || current.data.ogp }
                  : {}),
                ...(emailLogo || current.data?.emailLogo
                  ? { emailLogo: emailLogo || current.data.emailLogo }
                  : {}),
                ...(installGuide || current.data?.installGuide
                  ? { installGuide: installGuide || current.data.installGuide }
                  : {}),
              },
              publish: values.mode === "公開",
              ...(values.publishAt
                ? { publishAt: new Date(values.publishAt).toISOString() }
                : {}),
              reason: values.reason,
            });
            await refresh();
            await current.reload();
            await versions.reload();
            notify("ブランド設定を保存しました");
          }}
        >
          <Field
            name="name"
            label="アプリ名"
            value={current.data?.name ?? state.settings.name}
            required
          />
          <Field
            name="short"
            label="短縮名"
            value={current.data?.short ?? "まんぞうラブ"}
            required
          />
          <Field
            name="description"
            label="説明"
            value={current.data?.description ?? "マン組と、もっと近くに。"}
            multiline
          />
          <Field
            name="accent"
            label="テーマカラー"
            type="color"
            value={state.settings.accent}
          />
          <Field
            name="background"
            label="背景色"
            type="color"
            value={current.data?.background ?? "#050509"}
          />
          <Field
            name="button"
            label="主要ボタン色"
            type="color"
            value={current.data?.button ?? "#ffd45c"}
          />
          <Field
            name="logoAlt"
            label="ロゴの代替テキスト"
            value={current.data?.logoAlt ?? state.settings.name}
          />
          {[
            ["ロゴ", setLogo],
            ["アイコン", setIcon],
            ["共有時の画像（OGP）", setOgp],
            ["メールのロゴ", setEmailLogo],
            ["インストール案内画像", setInstallGuide],
            ["通知アイコン", setNotificationIcon],
          ].map(([label, setter]) => (
            <label key={String(label)} className="field">
              <span>{String(label)}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    (setter as (url: string) => void)(
                      (await upload(file, "image")).url,
                    );
                  } catch (error) {
                    notify((error as Error).message);
                  }
                }}
              />
            </label>
          ))}
          {(logo || current.data?.logo) && (
            <img
              src={logo || current.data.logo}
              alt="ロゴのプレビュー"
              style={{ maxHeight: 160, width: "100%", objectFit: "contain" }}
            />
          )}
          <Field
            name="terms"
            label="利用規約URL"
            type="url"
            value={current.data?.terms}
          />
          <Field
            name="privacy"
            label="プライバシーポリシーURL"
            type="url"
            value={current.data?.privacy}
          />
          <Field
            name="contact"
            label="お問い合わせ先"
            value={current.data?.contact}
          />
          <Field
            name="commerce"
            label="特定商取引法に基づく表記URL"
            type="url"
            value={current.data?.commerce}
          />
          <Select name="mode" label="保存方法" options={["下書き", "公開"]} />
          <Field
            name="publishAt"
            label="公開日時（空欄は即時）"
            type="datetime-local"
          />
          <Field name="reason" label="変更理由" required />
        </Form>
      </Panel>
      <LiveInstallGuides />
      <Panel title="過去の設定">
        {versions.data?.map((version) => (
          <Form
            key={version.id}
            submit="この設定へ戻す"
            onSubmit={async (values) => {
              await api(`/admin/brand/${version.id}/restore`, {
                reason: values.reason,
              });
              await refresh();
              await current.reload();
            }}
          >
            <p>
              {version.values.name} ·{" "}
              {new Date(version.at).toLocaleString("ja-JP")}
            </p>
            <Field name="reason" label="復元理由" required />
          </Form>
        ))}
      </Panel>
    </>
  );
}
