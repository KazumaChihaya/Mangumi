import React from "react";
import { api } from "../api";
import { useResource } from "./hooks";
import { Field, Form, Notice, Panel } from "../ui";
export function LiveEmailTemplates() {
  const templates = useResource<any[]>("/admin/email-templates", 0);
  return (
    <Panel title="認証メールのテンプレート">
      <Notice>
        {
          "本文では {{url}}（確認リンク）、{{name}}（会員名）、{{app}}（アプリ名）が使えます。公開中のメールロゴをHTMLに反映します。"
        }
      </Notice>
      {templates.error && <Notice>{templates.error}</Notice>}
      {[
        ["verify", "登録時のメール確認"],
        ["email", "メール変更の確認"],
        ["reset", "パスワード再設定"],
      ].map(([purpose, label]) => {
        const template = templates.data?.find((t) => t.purpose === purpose);
        return (
          <details key={purpose}>
            <summary>{label}</summary>
            <Form
              key={`${purpose}:${JSON.stringify(template)}`}
              submit="テンプレートを保存"
              onSubmit={async (v) => {
                await api("/admin/email-templates", {
                  template: { purpose, subject: v.subject, text: v.text },
                  reason: v.reason,
                });
                await templates.reload();
              }}
            >
              <Field
                name="subject"
                label="件名"
                value={template?.subject ?? label}
                required
              />
              <Field
                name="text"
                label="本文"
                multiline
                value={
                  template?.text ??
                  "{{name}}さん\n{{app}}の手続きはこちらです。\n{{url}}\n心当たりがない場合は破棄してください。"
                }
                required
              />
              <Field name="reason" label="変更理由" required />
            </Form>
          </details>
        );
      })}
    </Panel>
  );
}
