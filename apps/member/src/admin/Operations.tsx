import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { Screen } from "../registry";
import { useStore } from "../store";
import { probabilityTotal, validateTip, yen } from "../model";
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
  downloadCSV,
} from "../ui";
import { Chart, ConfigForm } from "./Common";
import { AssetUpload } from "./Content";
export function ModerationPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const [filter, setFilter] = useState("すべて");
  const report = state.reports.find((r) => r.id === item) ?? state.reports[0];
  if (screen.id === "A052")
    return (
      <>
        <div className="toolbar">
          <span className="eyebrow">COMMUNITY SAFETY</span>
          <Select
            name="status"
            label="対応状態"
            value={filter}
            onChange={setFilter}
            options={["すべて", "未対応", "調査中", "対応済み"]}
          />
        </div>
        <div className="metric-grid">
          <Metric
            label="未対応"
            value={state.reports.filter((r) => r.status === "未対応").length}
            icon="shield"
          />
          <Metric
            label="調査中"
            value={state.reports.filter((r) => r.status === "調査中").length}
            icon="search"
          />
          <Metric
            label="対応済み"
            value={state.reports.filter((r) => r.status === "対応済み").length}
            icon="check"
          />
          <Metric label="問い合わせ" value={state.support.length} icon="dm" />
        </div>
        <Panel title="通報キュー">
          <Table
            columns={["内容", "対象", "状態", "担当者", "操作"]}
            rows={state.reports
              .filter((r) => filter === "すべて" || r.status === filter)
              .map((r) => [
                r.reason,
                r.target,
                <Badge
                  key="badge"
                  tone={r.status === "未対応" ? "pink" : "gray"}
                >
                  {r.status}
                </Badge>,
                r.assignee,
                <RouteLink
                  key="details"
                  id="A053"
                  item={r.id}
                  className="button ghost small"
                >
                  確認
                </RouteLink>,
              ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A053")
    return (
      <>
        <Panel title="通報の内容">
          <Badge tone="pink">{report?.status ?? "通報なし"}</Badge>
          <h2 style={{ margin: "15px 0" }}>
            {report?.reason ?? "通報がありません"}
          </h2>
          <dl className="detail-grid">
            <dt>対象</dt>
            <dd>{report?.target}</dd>
            <dt>担当者</dt>
            <dd>{report?.assignee}</dd>
            <dt>通報ID</dt>
            <dd>{report?.id}</dd>
          </dl>
        </Panel>
        <Panel title="対象時点の証拠">
          <p className="result-data">
            {state.records[`evidence-${report?.id}`]?.body ??
              "このサンプル通報には実コンテンツの証拠は含まれていません。新しいDM通報では対象時点のメッセージを保存します。"}
          </p>
        </Panel>
        <div className="button-row">
          <Button id="A054" tone="ghost">
            DM調査
          </Button>
          <Button id="A055" tone="danger">
            措置を確認
          </Button>
          <Button id="A059" tone="gold">
            担当者を割当
          </Button>
        </div>
      </>
    );
  if (screen.id === "A054") {
    const allowed = ["スーパー管理者", "モデレーター"].includes(
      state.admins[0].role,
    );
    return allowed ? (
      <>
        <Notice>
          通報調査の目的に限って閲覧します。閲覧記録を監査ログに残してください。
        </Notice>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "reason",
              label: "調査目的",
              required: true,
              value: "通報内容の確認",
            },
          ]}
          submit="調査を記録"
        >
          <Panel title="DM本文（プレビュー）">
            {state.messages.map((m) => (
              <Row
                key={m.id}
                title={m.text}
                sub={`${m.mine ? state.profile.name : "まんぞう"} / ${m.time}`}
                end={<Badge tone="gray">{m.audio ? "音声" : "テキスト"}</Badge>}
              />
            ))}
          </Panel>
        </ConfigForm>
      </>
    ) : (
      <Panel>
        <Empty
          icon="shield"
          title="閲覧できないロールです"
          text="DMの調査はスーパー管理者とモデレーターに限定します。"
          action={<Button id="A005">権限の案内</Button>}
        />
      </Panel>
    );
  }
  if (screen.id === "A055")
    return (
      <Confirm
        title="モデレーション措置を確定"
        text={`${report?.target ?? "対象"}への対応を完了として記録します。対象・証拠・対応理由を確認してください。`}
        action="対応済みにする"
        reason
        back="A052"
        onConfirm={async (reason) => {
          await update(
            (d) => {
              const entry = d.reports.find((r) => r.id === report?.id);
              if (entry) {
                entry.status = "対応済み";
                entry.assignee = "運営管理者";
              }
            },
            "通報対応完了",
            report?.target ?? "通報",
            reason,
          );
          notify("対応結果を記録しました");
        }}
      />
    );
  if (screen.id === "A056")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "words",
            label: "NGワード（カンマ区切り）",
            value: state.settings.ngWords,
            multiline: true,
          },
          {
            name: "urls",
            label: "URL投稿の方針",
            options: ["許可したドメインのみ", "URLを禁止", "全URLを許可"],
          },
          {
            name: "rate",
            label: "連続投稿の上限（1分あたり）",
            value: 10,
            type: "number",
            min: 1,
            max: 60,
          },
          {
            name: "dm",
            label: "DMの範囲",
            value: state.settings.dmPolicy,
            options: ["公式配信者のみ", "相互フォローのみ", "許可制", "全員"],
          },
        ]}
        onSave={(v) =>
          update((d) => {
            d.settings.ngWords = v.words;
            d.settings.dmPolicy = v.dm;
          }, "モデレーション設定変更")
        }
      />
    );
  if (screen.id === "A057")
    return (
      <>
        <Panel title="停止アカウント">
          <Table
            columns={["会員", "状態", "プラン", "操作"]}
            rows={state.members
              .filter((m) => m.status !== "有効")
              .map((m) => [
                m.name,
                <Badge key="status" tone="pink">
                  {m.status}
                </Badge>,
                m.plan,
                <Button
                  key="restore"
                  tone="ghost"
                  className="small"
                  onClick={async () => {
                    await update(
                      (d) => {
                        d.members.find((x) => x.id === m.id)!.status = "有効";
                      },
                      "停止解除",
                      m.name,
                    );
                    notify("利用停止を解除しました");
                  }}
                >
                  解除
                </Button>,
              ])}
          />
        </Panel>
        <Panel title="ブロック状態">
          <Row
            title="プレビュー会員のブロック"
            sub={state.blocked ? "まんぞうをブロック中" : "ブロックなし"}
            id="U097"
          />
        </Panel>
      </>
    );
  if (screen.id === "A058")
    return (
      <Panel title="お問い合わせ・サポート案件">
        {state.support.length ? (
          state.support.map((s) => (
            <Panel title={s.subject} key={s.id}>
              <p className="readable-text">{s.body}</p>
              <div className="space-between" style={{ marginTop: 15 }}>
                <Badge>{s.status}</Badge>
                <Button
                  tone="gold"
                  className="small"
                  onClick={async () => {
                    await update(
                      (d) => {
                        d.support.find((x) => x.id === s.id)!.status =
                          "対応完了";
                      },
                      "問い合わせ対応",
                      s.subject,
                    );
                    notify("対応完了にしました");
                  }}
                >
                  対応完了
                </Button>
              </div>
            </Panel>
          ))
        ) : (
          <Empty
            icon="dm"
            title="お問い合わせはありません"
            text="利用者のヘルプ画面から追加すると、ここで確認できます。"
            action={
              <Button id="U101" tone="ghost">
                問い合わせ画面を見る
              </Button>
            }
          />
        )}
      </Panel>
    );
  return (
    <ConfigForm
      screen={screen}
      fields={[
        {
          name: "report",
          label: "対象通報",
          options: state.reports.map((r) => r.reason),
          value: report?.reason,
        },
        {
          name: "assignee",
          label: "担当者",
          options: ["運営管理者", "モデレーター", "サポート担当"],
        },
        {
          name: "deadline",
          label: "対応期限",
          type: "datetime-local",
          required: true,
        },
        {
          name: "status",
          label: "対応状態",
          options: ["未対応", "調査中", "対応済み"],
        },
      ]}
      onSave={(v) =>
        update(
          (d) => {
            const r = d.reports.find((r) => r.reason === v.report);
            if (r) {
              r.assignee = v.assignee;
              r.status = v.status;
            }
          },
          "通報担当者割当",
          v.report,
        )
      }
    />
  );
}
export function PaymentsAdmin({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const [error, setError] = useState("");
  const total = state.tips
    .filter((t) => t.status === "テスト完了")
    .reduce((sum, t) => sum + t.amount, 0);
  const exportSales = () =>
    downloadCSV(
      "tips.csv",
      ["ID", "日時", "受取対象", "金額", "状態"],
      state.tips.map((t) => [t.id, t.at, t.recipient, t.amount, t.status]),
    );
  if (["A060", "A065"].includes(screen.id))
    return (
      <>
        <div className="metric-grid">
          <Metric label="テスト売上" value={yen(total)} icon="heart" />
          <Metric label="テスト決済数" value={state.tips.length} icon="check" />
          <Metric
            label="テスト返金"
            value={yen(
              state.tips
                .filter((t) => t.status === "テスト返金済み")
                .reduce((s, t) => s + t.amount, 0),
            )}
            icon="shield"
          />
          <Metric label="決済事業者" value="未接続" icon="gear" />
        </div>
        <div className="two-columns">
          <Panel title="売上の推移（サンプル）">
            <Chart gold />
          </Panel>
          <Panel title="受取対象別">
            <Table
              columns={["受取対象", "テスト売上"]}
              rows={["まんぞう", "マン組"].map((name) => [
                name,
                yen(
                  state.tips
                    .filter(
                      (t) => t.recipient === name && t.status === "テスト完了",
                    )
                    .reduce((s, t) => s + t.amount, 0),
                ),
              ])}
            />
          </Panel>
        </div>
        <Panel title="CSV出力">
          <Notice>
            実際の売上ではありません。配信者への自動送金は行いません。
          </Notice>
          <Button tone="gold" icon="download" onClick={exportSales}>
            テスト売上CSVを出力
          </Button>
        </Panel>
      </>
    );
  if (screen.id === "A061")
    return (
      <>
        <div className="toolbar">
          <Badge>PAYMENT OPERATIONS</Badge>
          <Button tone="ghost" onClick={exportSales} icon="download">
            CSV
          </Button>
        </div>
        <Panel title="投げ銭決済一覧">
          <Table
            columns={["取引ID", "日時", "受取対象", "金額", "状態", "操作"]}
            rows={state.tips.map((t) => [
              t.id.slice(0, 8),
              new Date(t.at).toLocaleString("ja-JP"),
              t.recipient,
              yen(t.amount),
              <Badge key="status">{t.status}</Badge>,
              <RouteLink
                key="refund"
                id="A062"
                item={t.id}
                className="button ghost small"
              >
                返金確認
              </RouteLink>,
            ])}
            empty="テスト決済はありません。利用者側の応援フローから確認できます。"
          />
        </Panel>
      </>
    );
  if (screen.id === "A062")
    return (
      <Panel className="confirmation">
        <Empty
          icon="shield"
          title="テスト返金の確認"
          text="対象と理由を確認し、プレビューの取引状態を更新します。実際の返金は行いません。"
        />
        <Form
          submit="テスト返金を記録"
          tone="danger"
          onSubmit={async (v) => {
            if (!v.tip) {
              notify("返金対象がありません");
              return;
            }
            await update(
              (d) => {
                const tip = d.tips.find((t) => t.id === v.tip);
                if (tip) tip.status = "テスト返金済み";
              },
              "テスト返金",
              v.tip,
              v.reason,
            );
            notify("テスト返金を記録しました");
          }}
        >
          <Select
            name="tip"
            label="対象取引"
            options={state.tips
              .filter((t) => t.status === "テスト完了")
              .map((t) => t.id)}
          />
          <Field name="reason" label="返金理由" multiline required />
          <label className="check-row">
            <input type="checkbox" required />
            対象と金額を確認しました
          </label>
        </Form>
      </Panel>
    );
  if (screen.id === "A063")
    return (
      <Panel title="チャージバック管理">
        <Empty
          icon="shield"
          title="対象の取引はありません"
          text="決済事業者を接続すると、異議申立ての内容・回答期限・証跡を管理できます。"
        />
        <Table
          columns={["取引", "期限", "状態", "証跡"]}
          rows={[]}
          empty="決済サービス未接続"
        />
        <Button id="A084" tone="ghost">
          サービスの接続状態を確認
        </Button>
      </Panel>
    );
  if (screen.id === "A064")
    return (
      <Panel title="投げ銭金額と上限">
        <Form
          onSubmit={async (v) => {
            const max = Number(v.max);
            if (!validateTip(max, 100000)) {
              setError("上限は100〜100,000円の整数にしてください");
              return;
            }
            await update((d) => {
              d.settings.tipMax = max;
              d.records.A064 = v;
            }, "投げ銭上限変更");
            notify("利用者画面の上限に反映しました");
          }}
        >
          <div className="field-grid">
            <Field
              label="1回の最高金額（円）"
              name="max"
              type="number"
              value={state.settings.tipMax}
              required
              min={100}
              max={100000}
            />
            <Field
              label="月次上限（円）"
              name="monthly"
              type="number"
              value={30000}
              min={100}
            />
            <Field
              label="日次上限（円）"
              name="daily"
              type="number"
              value={10000}
              min={100}
            />
            <Field
              label="候補金額"
              name="amounts"
              value="100, 500, 1000, 3000, 5000, 10000"
            />
          </div>
          <Notice>
            最低額の初期値は100円です。日次・月次・候補金額の制御は本番API接続時に反映します。
          </Notice>
          {error && <Notice tone="error">{error}</Notice>}
        </Form>
      </Panel>
    );
  return (
    <>
      <Panel title="受取対象">
        <Table
          columns={["公式配信者", "投げ銭対象", "分配方法"]}
          rows={["まんぞう", "マン組"].map((name) => [
            name,
            <Badge key={name} tone="green">
              対象
            </Badge>,
            "契約確定後、運営の経理処理",
          ])}
        />
      </Panel>
      <Panel title="決済事業者">
        <Row
          title="Stripe（Web版の候補）"
          sub="未接続 / カード番号・CVCは保存しません"
          id="A084"
          end={<Badge tone="gray">未接続</Badge>}
        />
        <Row
          title="StoreKit / Google Play Billing"
          sub="ネイティブ版の展開時に追加"
          end={<Badge tone="gray">今後対応</Badge>}
        />
      </Panel>
    </>
  );
}
export function GachaAdmin({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const [weights, setWeights] = useState(
    state.probabilities.map((p) => p.weight),
  );
  const [error, setError] = useState("");
  const [image, setImage] = useState("/assets/thumb_1.jpg");
  if (screen.id === "A067")
    return (
      <>
        <div className="toolbar">
          <Notice>無料チケット方式。景品の換金・譲渡・売買は不可です。</Notice>
          <Button id="A068" icon="plus">
            キャンペーンを編集
          </Button>
        </div>
        <Panel title="ガチャキャンペーン">
          <Table
            columns={[
              "キャンペーン",
              "開催期間",
              "状態",
              "確率バージョン",
              "操作",
            ]}
            rows={[
              [
                state.gacha.title,
                `${state.gacha.start}〜${state.gacha.end}`,
                <Badge key="status">{state.gacha.status}</Badge>,
                state.probabilityVersion,
                <Button key="edit" id="A070" tone="ghost" className="small">
                  提供割合
                </Button>,
              ],
            ]}
          />
        </Panel>
        <div className="metric-grid">
          <Metric
            label="景品数"
            value={state.probabilities.length}
            icon="star"
          />
          <Metric
            label="プレビュー抽選数"
            value={state.draws.length}
            icon="ticket"
          />
          <Metric
            label="提供割合合計"
            value={`${probabilityTotal(state.probabilities)}%`}
            icon="check"
          />
          <Metric label="残りチケット" value={state.tickets} icon="ticket" />
        </div>
      </>
    );
  if (screen.id === "A068")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "title",
            label: "キャンペーン名",
            value: state.gacha.title,
            required: true,
          },
          {
            name: "start",
            label: "開始日",
            type: "date",
            value: state.gacha.start,
            required: true,
          },
          {
            name: "end",
            label: "終了日",
            type: "date",
            value: state.gacha.end,
            required: true,
          },
          {
            name: "plan",
            label: "対象プラン",
            options: ["すべて", ...state.plans.map((p) => p.name)],
          },
          {
            name: "ticket",
            label: "必要チケット数",
            value: 1,
            type: "number",
            min: 1,
          },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              d.gacha.title = v.title;
              d.gacha.start = v.start;
              d.gacha.end = v.end;
            },
            "ガチャキャンペーン編集",
            v.title,
          )
        }
      />
    );
  if (screen.id === "A069")
    return (
      <>
        <Panel title="景品を登録">
          <Form
            onSubmit={async (v) => {
              await update(
                (d) => {
                  d.probabilities.push({
                    title: v.title,
                    rarity: v.rarity,
                    weight: 0,
                    image,
                  });
                },
                "ガチャ景品登録",
                v.title,
              );
              notify("景品を登録しました。提供割合を設定してください");
            }}
          >
            <div className="field-grid">
              <Field name="title" label="景品名" required />
              <Select
                name="rarity"
                label="レアリティ"
                options={["R", "SR", "SSR"]}
              />
              <Field
                name="stock"
                label="在庫数（0は無制限）"
                type="number"
                min={0}
                value={0}
              />
              <Select
                name="duplicate"
                label="重複時の扱い"
                options={["重複獲得を許可", "チケットで補填（設定後）"]}
              />
            </div>
            <AssetUpload value={image} onChange={setImage} />
            <Notice>
              新規景品の提供割合は0%で登録します。公開前に提供割合を更新してください。
            </Notice>
          </Form>
        </Panel>
        <Panel title="登録済み景品">
          <Table
            columns={["景品", "レアリティ", "提供割合"]}
            rows={state.probabilities.map((p) => [
              p.title,
              p.rarity,
              `${p.weight}%`,
            ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A070")
    return (
      <>
        <Panel title="提供割合とバージョン">
          <Form
            submit="新バージョンとして保存"
            onSubmit={async () => {
              if (
                weights.some((w) => !Number.isFinite(w) || w < 0) ||
                weights.reduce((a, b) => a + b, 0) !== 100
              ) {
                setError("提供割合の合計を厳密に100%にしてください");
                return;
              }
              await update(
                (d) => {
                  d.probabilityVersions.push({
                    version: d.probabilityVersion,
                    at: new Date().toISOString(),
                    items: structuredClone(d.probabilities),
                  });
                  d.probabilities.forEach((p, i) => {
                    p.weight = weights[i];
                  });
                  d.probabilityVersion = `preview-${Date.now()}`;
                },
                "ガチャ確率バージョン作成",
                state.gacha.title,
              );
              setError("");
              notify("新しい確率バージョンを保存しました");
            }}
          >
            <div className="field-grid">
              {state.probabilities.map((p, i) => (
                <Field
                  key={p.title}
                  name={`weight-${i}`}
                  label={`${p.rarity} / ${p.title}（%）`}
                  type="number"
                  min={0}
                  max={100}
                  value={weights[i] ?? 0}
                  onChange={(value) =>
                    setWeights((current) => {
                      const next = [...current];
                      next[i] = Number(value);
                      return next;
                    })
                  }
                />
              ))}
            </div>
            <div className="space-between">
              <strong>提供割合の合計</strong>
              <Badge
                tone={
                  weights.reduce((a, b) => a + b, 0) === 100 ? "green" : "pink"
                }
              >
                {weights.reduce((a, b) => a + b, 0)}%
              </Badge>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Notice>
              公開済みの確率を上書きせず、新バージョンを作ります。過去の抽選は当時のバージョンを保持します。
            </Notice>
          </Form>
        </Panel>
        <Panel title="確率の履歴">
          <Table
            columns={["バージョン", "保存日", "合計"]}
            rows={state.probabilityVersions.map((v) => [
              v.version,
              new Date(v.at).toLocaleString("ja-JP"),
              `${probabilityTotal(v.items)}%`,
            ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A071")
    return (
      <Panel title="抽選・チケット履歴">
        <Table
          columns={["抽選ID", "景品", "レアリティ", "確率バージョン", "日時"]}
          rows={state.draws.map((d) => [
            d.id.slice(0, 8),
            d.title,
            <Badge key="rarity">{d.rarity}</Badge>,
            d.version,
            new Date(d.at).toLocaleString("ja-JP"),
          ])}
        />
        <Notice>
          抽選結果は編集できません。補填が必要な場合は別の付与操作として記録します。
        </Notice>
      </Panel>
    );
  if (screen.id === "A072")
    return (
      <>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "target",
              label: "配布対象",
              options: ["プレビュー会員", "指定プラン（本番接続後）"],
            },
            {
              name: "count",
              label: "配布枚数",
              type: "number",
              value: 3,
              min: 1,
              max: 100,
            },
            {
              name: "reason",
              label: "配布理由",
              required: true,
              value: "キャンペーン配布",
            },
          ]}
          onSave={(v) =>
            update(
              (d) => {
                d.tickets += Number(v.count);
              },
              "無料チケット配布",
              state.profile.name,
              v.reason,
            )
          }
        />
        <Panel title="配布履歴">
          <Table
            columns={["操作", "対象", "理由", "日時"]}
            rows={state.audit
              .filter((a) => /チケット/.test(a.action))
              .map((a) => [
                a.action,
                a.target,
                a.reason,
                new Date(a.at).toLocaleString("ja-JP"),
              ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A073")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "prize",
            label: "補填する景品",
            options: state.probabilities.map((p) => p.title),
          },
          {
            name: "reason",
            label: "補填理由",
            multiline: true,
            required: true,
          },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              const p = d.probabilities.find((p) => p.title === v.prize)!;
              d.draws.unshift({
                id: crypto.randomUUID(),
                title: p.title,
                rarity: p.rarity,
                image: p.image,
                at: new Date().toISOString(),
                version: "compensation-preview",
              });
            },
            "景品補填",
            state.profile.name,
            v.reason,
          )
        }
        notice="抽選結果の変更ではなく、別の付与履歴として記録します。"
      />
    );
  return (
    <Panel className="confirmation">
      <Empty
        icon="ticket"
        title="キャンペーン公開の確認"
        text={`${state.gacha.title} / 提供割合合計 ${probabilityTotal(state.probabilities)}%`}
      />
      <Form
        submit="公開状態を変更"
        onSubmit={async (v) => {
          if (probabilityTotal(state.probabilities) !== 100) {
            setError("提供割合が100%になっていません");
            return;
          }
          await update(
            (d) => {
              d.gacha.status = v.status;
            },
            "ガチャ公開状態変更",
            state.gacha.title,
            v.reason,
          );
          notify("公開状態を変更しました");
        }}
      >
        <Select
          name="status"
          label="公開状態"
          value={state.gacha.status}
          options={["公開", "停止", "下書き"]}
        />
        <Field name="reason" label="変更理由" required />
        <label className="check-row">
          <input type="checkbox" required />
          景品・提供割合・対象条件を確認しました
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </Form>
    </Panel>
  );
}
