import React, { useState } from "react";
import { api, upload } from "../api";
import { useStore } from "../store";
import { useResource } from "./hooks";
import { Button, Field, Form, Notice, Panel, Select } from "../ui";
export function LiveInstallGuides() {
  const guides = useResource<any[]>("/admin/install-guides", 0);
  const [editing, setEditing] = useState<any>();
  const [image, setImage] = useState("");
  const { notify } = useStore();
  return (
    <Panel title="端末・ブラウザ別のインストール案内">
      {guides.error && <Notice>{guides.error}</Notice>}
      {guides.data?.map((g) => (
        <div key={g.id}>
          <Button
            tone="ghost"
            onClick={() => {
              setEditing(g);
              setImage(g.image);
            }}
          >
            {g.title} · {g.os}/{g.browser} · 最終確認{g.verifiedAt}
          </Button>
          <Form
            submit="案内を削除"
            tone="danger"
            onSubmit={async (v) => {
              await api(`/admin/install-guides/${g.id}`, v, "DELETE");
              await guides.reload();
            }}
          >
            <Field name="reason" label="削除理由" required />
          </Form>
        </div>
      ))}
      <Button
        tone="ghost"
        onClick={() => {
          setEditing(undefined);
          setImage("");
        }}
      >
        新しい案内
      </Button>
      <Form
        key={editing?.id ?? "new"}
        submit="案内を保存"
        onSubmit={async (v) => {
          if (!image) throw new Error("案内画像をアップロードしてください");
          await api("/admin/install-guides", {
            guide: {
              ...(editing ? { id: editing.id } : {}),
              title: v.title,
              body: v.body,
              image,
              os: v.os,
              browser: v.browser,
              minVersion: Number(v.minVersion),
              maxVersion: Number(v.maxVersion),
              order: Number(v.order),
              published: v.published === "公開",
              verifiedAt: v.verifiedAt,
            },
            reason: v.reason,
          });
          await guides.reload();
          notify("インストール案内を保存しました");
        }}
      >
        <Field
          name="title"
          label="案内タイトル"
          value={editing?.title}
          required
        />
        <Field
          name="body"
          label="手順（1行に1手順）"
          value={editing?.body}
          multiline
          required
        />
        <Select
          name="os"
          label="OS"
          options={["iOS", "Android", "Windows", "macOS", "any"]}
          value={editing?.os}
        />
        <Select
          name="browser"
          label="ブラウザ"
          options={["Safari", "Chrome", "Edge", "Firefox", "any"]}
          value={editing?.browser}
        />
        <Field
          name="minVersion"
          label="OSの最小メジャーバージョン"
          type="number"
          min={0}
          max={999}
          value={editing?.minVersion ?? 0}
          required
        />
        <Field
          name="maxVersion"
          label="OSの最大メジャーバージョン"
          type="number"
          min={0}
          max={999}
          value={editing?.maxVersion ?? 999}
          required
        />
        <Field
          name="order"
          label="表示順"
          type="number"
          min={0}
          value={editing?.order ?? 0}
          required
        />
        <Select
          name="published"
          label="公開状態"
          options={["下書き", "公開"]}
          value={editing?.published ? "公開" : "下書き"}
        />
        <Field
          name="verifiedAt"
          label="手順の最終確認日"
          type="date"
          value={editing?.verifiedAt ?? new Date().toISOString().slice(0, 10)}
          required
        />
        <label className="field">
          <span>案内画像</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setImage((await upload(file, "image")).url);
              } catch (error) {
                notify((error as Error).message);
              }
            }}
          />
        </label>
        {image && (
          <img
            src={image}
            alt="案内プレビュー"
            style={{ width: "100%", maxHeight: 300, objectFit: "contain" }}
          />
        )}
        <Field name="reason" label="変更理由" required />
      </Form>
    </Panel>
  );
}
