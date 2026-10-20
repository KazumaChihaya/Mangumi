import React, { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { Button, Field, Form, Notice, Panel, Select, Table } from "../ui";
import { useResource } from "./hooks";
export function LiveNotifications() {
  const { state, notify } = useStore();
  const templates = useResource<any[]>("/admin/notification-templates", 0);
  const campaigns = useResource<any[]>("/admin/notifications");
  const [template, setTemplate] = useState<any>();
  const [preview, setPreview] = useState<any>();
  const audience = (v: Record<string, string>) => ({
    plans: v.plan === "全会員" ? [] : [v.plan],
    permission: v.permission,
    users: v.users.split(/[\s,]+/).filter(Boolean),
    ...(v.gender !== "すべて" ? { genders: [v.gender] } : {}),
    ...(v.activeSince
      ? { activeSince: new Date(v.activeSince).toISOString() }
      : {}),
    ...(v.inactiveSince
      ? { inactiveSince: new Date(v.inactiveSince).toISOString() }
      : {}),
  });
  return (
    <>
      {(campaigns.error || templates.error) && (
        <Notice tone="error">{campaigns.error || templates.error}</Notice>
      )}
      <Panel title="通知テンプレート">
        {templates.data?.map((t) => (
          <div key={t.id}>
            <Button tone="ghost" onClick={() => setTemplate(t)}>
              {t.name}を編集・利用
            </Button>
            <Button
              tone="danger"
              onClick={async () => {
                await api(
                  `/admin/notification-templates/${t.id}`,
                  { reason: "テンプレートの削除" },
                  "DELETE",
                );
                await templates.reload();
              }}
            >
              削除
            </Button>
          </div>
        ))}
        <Button tone="ghost" onClick={() => setTemplate(undefined)}>
          新規テンプレート
        </Button>
        <Form
          key={template?.id ?? "new"}
          submit="テンプレートを保存"
          onSubmit={async (v) => {
            await api("/admin/notification-templates", {
              ...v,
              ...(template ? { id: template.id } : {}),
            });
            await templates.reload();
            notify("テンプレートを保存しました");
          }}
        >
          <Field
            name="name"
            label="テンプレート名"
            value={template?.name}
            required
          />
          <Field
            name="title"
            label="タイトル"
            value={template?.title}
            required
          />
          <Field
            name="body"
            label="本文"
            value={template?.body}
            multiline
            required
          />
          <Field
            name="path"
            label="アプリ内リンク"
            value={template?.path ?? "/"}
            required
          />
          <Field name="reason" label="変更理由" required />
        </Form>
      </Panel>
      <Panel title="通知対象を確認・配信">
        <Form
          key={`send-${template?.id ?? "new"}`}
          submit="選択した処理を実行"
          onSubmit={async (v) => {
            const body = {
              title: v.title,
              body: v.body,
              path: v.path,
              audience: audience(v),
              ...(v.scheduledAt
                ? { scheduledAt: new Date(v.scheduledAt).toISOString() }
                : {}),
            };
            if (v.action === "対象を確認") {
              setPreview(
                await api("/admin/notification-audience", body.audience),
              );
              return;
            }
            if (v.action === "自分へテスト") {
              await api("/admin/notifications/test", body);
              notify("テスト通知を受け付けました");
              return;
            }
            await api(
              "/admin/notifications",
              body,
              "POST",
              "admin",
              crypto.randomUUID(),
            );
            await campaigns.reload();
            notify("通知を受け付けました");
          }}
        >
          <Field
            name="title"
            label="通知タイトル"
            value={template?.title}
            required
          />
          <Field
            name="body"
            label="通知本文"
            value={template?.body}
            multiline
            required
          />
          <Field
            name="path"
            label="アプリ内リンク"
            value={template?.path ?? "/"}
            required
          />
          <Select
            name="plan"
            label="対象プラン"
            options={["全会員", ...state.plans.map((p) => p.name)]}
          />
          <Select
            name="permission"
            label="通知許可状態"
            options={["any", "subscribed", "unsubscribed"]}
          />
          <Select
            name="gender"
            label="会員属性"
            options={["すべて", "男性", "女性", "その他", "回答しない"]}
          />
          <Field
            name="users"
            label="個別会員ID（カンマ区切り、空欄は条件に合う全員）"
          />
          <Field
            name="activeSince"
            label="この日時以降に利用"
            type="datetime-local"
          />
          <Field
            name="inactiveSince"
            label="この日時以降に利用していない"
            type="datetime-local"
          />
          <Field
            name="scheduledAt"
            label="配信日時（空欄は即時）"
            type="datetime-local"
          />
          <Select
            name="action"
            label="実行する処理"
            options={["対象を確認", "自分へテスト", "配信を開始・予約"]}
          />
          <label className="check-row">
            <input type="checkbox" required />
            対象と内容を確認しました
          </label>
        </Form>
        {preview && (
          <Notice>
            該当する会員：{preview.count}人<br />
            {preview.sample.map((u: any) => u.name).join("、")}
          </Notice>
        )}
      </Panel>
      <Panel title="配信結果">
        <Table
          columns={[
            "タイトル",
            "状態",
            "対象人数",
            "処理済み",
            "端末送信",
            "失敗",
            "クリック",
          ]}
          rows={(campaigns.data ?? []).map((c) => [
            c.title,
            c.status,
            c.count,
            c.processed,
            c.sent,
            c.failed,
            c.clicked,
          ])}
        />
        {campaigns.data?.map((c) => (
          <details key={c.id}>
            <summary>{c.title}の詳細</summary>
            <p>
              予約：
              {c.scheduledAt
                ? new Date(c.scheduledAt).toLocaleString("ja-JP")
                : "即時"}
              ・設定によるスキップ：{c.skipped}
            </p>
            {c.failures.map((f: any) => (
              <p key={f.deviceId}>
                {f.deviceId}：{f.code}
              </p>
            ))}
            {c.status === "予約" && (
              <Form
                submit="予約を取り消す"
                tone="danger"
                onSubmit={async (v) => {
                  await api(`/admin/notifications/${c.id}/cancel`, v);
                  await campaigns.reload();
                }}
              >
                <Field name="reason" label="取消理由" required />
              </Form>
            )}
          </details>
        ))}
      </Panel>
    </>
  );
}
