import React from "react";
import { api } from "../api";
import { useResource } from "./hooks";
import { Field, Form, Notice, Panel, Select, Table } from "../ui";
export function LiveRetention() {
  const data = useResource("/admin/retention", 0);
  const policy = data.data?.policy;
  return (
    <Panel title="データの保存期間と自動削除">
      {data.error && <Notice tone="error">{data.error}</Notice>}
      <Notice>
        通報調査中の証拠、保留中の証拠、獲得した景品、決済と監査記録を保持します。初期状態では自動削除は無効です。公開する保存方針に合わせて設定してください。
      </Notice>
      {policy && (
        <Form
          key={JSON.stringify(policy)}
          submit="保存方針を適用"
          onSubmit={async (v) => {
            await api(
              "/admin/retention",
              {
                policy: {
                  enabled: v.enabled === "有効",
                  dmDays: Number(v.dmDays),
                  storyDays: Number(v.storyDays),
                  orphanDays: Number(v.orphanDays),
                  reportHoldDays: Number(v.reportHoldDays),
                },
                reason: v.reason,
              },
              "PUT",
            );
            await data.reload();
          }}
        >
          <Select
            name="enabled"
            label="自動削除"
            value={policy.enabled ? "有効" : "無効"}
            options={["無効", "有効"]}
          />
          {Object.entries({
            dmDays: "DM保存日数",
            storyDays: "公開終了後のストーリー保存日数",
            orphanDays: "未使用ファイル保存日数",
            reportHoldDays: "通報解決後の証拠保持日数",
          }).map(([key, label]) => (
            <Field
              key={key}
              name={key}
              label={label}
              type="number"
              min={1}
              max={key === "orphanDays" ? 365 : 3650}
              value={policy[key]}
              required
            />
          ))}
          <Field name="reason" label="変更理由" required />
        </Form>
      )}
      <p>
        現在の削除対象：{data.data?.entities.length ?? 0}件・ファイル
        {data.data?.files.length ?? 0}件（{data.data?.bytes ?? 0}
        バイト）／保持対象の通報：{data.data?.heldReports ?? 0}件
      </p>
      {policy?.enabled && (
        <Form
          submit="削除処理を実行"
          tone="danger"
          onSubmit={async (v) => {
            await api("/admin/retention/run", {
              reason: v.reason,
              confirmed: true,
            });
            await data.reload();
          }}
        >
          <Field name="reason" label="実行理由" required />
          <label className="check-row">
            <input type="checkbox" required />
            表示された対象の削除を確認しました
          </label>
        </Form>
      )}
      <Table
        columns={["実行日時", "削除レコード", "削除ファイル", "バイト"]}
        rows={(data.data?.runs ?? []).map((r: any) => [
          r.at,
          r.deletedRecords,
          r.queuedFiles,
          r.bytes,
        ])}
      />
    </Panel>
  );
}
