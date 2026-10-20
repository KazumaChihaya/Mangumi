import React, { useState } from "react";
import {
  Button,
  Field,
  Form,
  Metric,
  Notice,
  Panel,
  Select,
  Table,
} from "../ui";
import { api } from "../api";
import { useResource } from "./hooks";
export function LiveMonitoring() {
  const metrics = useResource("/admin/metrics");
  const alerts = useResource("/admin/monitoring"),
    policy = alerts.data?.policy;
  return (
    <Panel title="システム監視">
      {metrics.error && <Notice tone="error">{metrics.error}</Notice>}
      <div className="metric-grid">
        <Metric
          label="稼働時間（秒）"
          value={metrics.data?.uptimeSeconds ?? 0}
        />
        <Metric
          label="DB応答（ms）"
          value={metrics.data?.databaseMs?.toFixed(1) ?? "—"}
        />
        <Metric
          label="メモリ（MB）"
          value={Math.round((metrics.data?.memoryBytes ?? 0) / 1024 / 1024)}
        />
      </div>
      <Notice>
        API応答時間は起動後の直近500リクエスト／ルートの95パーセンタイルです。音声品質には端末から送られた直近24時間の診断値を表示します。
      </Notice>
      <Table
        columns={["ルート", "要求数", "サーバーエラー", "p95（ms）"]}
        rows={(metrics.data?.routes ?? []).map((r: any) => [
          r.route,
          r.requests,
          r.errors,
          r.p95Ms.toFixed(1),
        ])}
      />
      <Table
        columns={["ジョブ状態", "件数"]}
        rows={(metrics.data?.jobs ?? []).map((r: any) => [r.state, r.count])}
      />
      <Table
        columns={["ルーム", "会員", "品質", "再接続回数", "確認時刻"]}
        rows={(metrics.data?.voice ?? []).map((r: any) => [
          r.roomId,
          r.userId,
          r.quality,
          r.reconnects,
          r.at,
        ])}
      />
      <h3>異常時のメール通知</h3>
      <Notice>
        直近5分間のAPIサンプルと失敗ジョブを1分ごとに確認します。回復時にも通知します。VPS自体の停止は別のサービスから死活監視してください。
      </Notice>
      {alerts.error && <Notice tone="error">{alerts.error}</Notice>}
      {policy && (
        <Form
          key={JSON.stringify(policy)}
          submit="アラート設定を保存"
          onSubmit={async (v) => {
            await api("/admin/monitoring", {
              policy: {
                enabled: v.enabled === "有効",
                recipients: v.recipients
                  .split(/[,、\s]+/)
                  .map((s: string) => s.trim())
                  .filter(Boolean),
                p95Ms: Number(v.p95Ms),
                errorPercent: Number(v.errorPercent),
                minimumRequests: Number(v.minimumRequests),
                failedJobs: Number(v.failedJobs),
                cooldownMinutes: Number(v.cooldownMinutes),
              },
              reason: v.reason,
            });
            await alerts.reload();
          }}
        >
          <Select
            name="enabled"
            label="異常通知"
            value={policy.enabled ? "有効" : "無効"}
            options={["無効", "有効"]}
          />
          <Field
            name="recipients"
            label="通知先メール（最大5件、カンマ区切り）"
            value={policy.recipients.join(", ")}
          />
          {(
            [
              ["p95Ms", "API p95閾値（ms）", 100, 60000],
              ["errorPercent", "サーバーエラー率（%）", 1, 100],
              ["minimumRequests", "判定に必要な最小要求数", 5, 500],
              ["failedJobs", "失敗ジョブ件数の閾値", 1, 10000],
              ["cooldownMinutes", "継続異常の再通知間隔（分）", 5, 1440],
            ] as const
          ).map(([key, label, min, max]) => (
            <Field
              key={key}
              name={key}
              label={label}
              type="number"
              min={min}
              max={max}
              value={policy[key]}
              required
            />
          ))}
          <Field name="reason" label="アラート設定の変更理由" required />
        </Form>
      )}
      <Table
        columns={["日時", "状態", "検知内容"]}
        rows={(alerts.data?.history ?? []).map((a: any) => [
          a.at,
          a.active ? "異常" : "回復",
          a.reasons.join(" / ") || "閾値内",
        ])}
      />
    </Panel>
  );
}
export function LiveAudit() {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const data = useResource(
    `/admin/audit?query=${encodeURIComponent(query)}&page=${page}`,
    0,
  );
  return (
    <Panel title="監査ログ・変更前後の比較">
      <Form
        submit="検索"
        onSubmit={(v) => {
          setQuery(v.query);
          setPage(0);
        }}
      >
        <Field name="query" label="操作・対象・理由・操作者ID" />
      </Form>
      {data.error && <Notice>{data.error}</Notice>}
      <p>{data.data?.total ?? 0}件</p>
      <Table
        columns={["日時", "操作者", "操作", "対象", "理由", "IP"]}
        rows={(data.data?.items ?? []).map((r: any) => [
          r.created_at,
          r.actor_id,
          r.action,
          r.target,
          r.reason,
          r.ip,
        ])}
      />
      {(data.data?.items ?? []).map((r: any) => (
        <details key={r.id}>
          <summary>
            {r.created_at} · {r.action}
          </summary>
          <h3>変更前</h3>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(JSON.parse(r.before_json), null, 2)}
          </pre>
          <h3>変更後</h3>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(JSON.parse(r.after_json), null, 2)}
          </pre>
        </details>
      ))}
      <div className="button-row">
        <Button tone="ghost" disabled={!page} onClick={() => setPage(page - 1)}>
          前へ
        </Button>
        <Button
          tone="ghost"
          disabled={(page + 1) * 50 >= (data.data?.total ?? 0)}
          onClick={() => setPage(page + 1)}
        >
          次へ
        </Button>
      </div>
    </Panel>
  );
}
