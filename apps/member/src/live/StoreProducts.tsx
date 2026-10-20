import React, { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { Button, Field, Form, Notice, Panel, Select, Table } from "../ui";
import { useResource } from "./hooks";
export function LiveStoreProducts({ editable = true }: { editable?: boolean }) {
  const { state } = useStore(),
    data = useResource<any[]>("/admin/store-products", 0),
    [editing, setEditing] = useState<any>();
  return (
    <Panel title="App Store／Google Playの商品設定">
      <Notice>
        ストア側に登録した商品IDを、コインまたはプランへ紐付けます。コインは応援専用です。無料ガチャのチケット・確率・権限は変わりません。ストアの実価格と対象地域は各ストアで設定してください。
      </Notice>
      {data.error && <Notice tone="error">{data.error}</Notice>}
      <Table
        columns={[
          "ストア",
          "商品ID",
          "名称",
          "種類",
          "コイン／プラン",
          "状態",
          "操作",
        ]}
        rows={(data.data ?? []).map((p) => [
          p.platform,
          p.productId,
          p.title,
          p.kind,
          p.kind === "coins"
            ? `${p.credits}コイン`
            : `${p.planId} · ${p.period ?? "month"}`,
          p.published ? "公開" : "非公開",
          editable ? (
            <Button key={p.id} onClick={() => setEditing(p)}>
              編集する
            </Button>
          ) : (
            "閲覧のみ"
          ),
        ])}
      />
      {editable && (
        <>
          <Button
            onClick={() =>
              setEditing({
                platform: "ios",
                productId: "",
                title: "",
                kind: "coins",
                amount: 500,
                credits: 500,
                period: "month",
                published: false,
              })
            }
          >
            ストア商品を追加
          </Button>
          {editing && (
            <Form
              key={`${editing.platform}:${editing.productId}`}
              submit="ストア商品を保存"
              onSubmit={async (values) => {
                await api("/admin/store-products", {
                  product: {
                    platform: values.platform,
                    productId: values.productId,
                    title: values.title,
                    kind: values.kind,
                    amount: Number(values.amount),
                    currency: "JPY",
                    published: values.published === "公開",
                    ...(values.kind === "coins"
                      ? { credits: Number(values.credits) }
                      : { planId: values.planId, period: values.period }),
                  },
                  reason: values.reason,
                });
                await data.reload();
                setEditing(undefined);
              }}
            >
              <Select
                name="platform"
                label="ストア"
                options={["ios", "android"]}
                value={editing.platform}
              />
              <Field
                name="productId"
                label="商品ID"
                value={editing.productId}
                required
              />
              <Field
                name="title"
                label="ストア商品の名称"
                value={editing.title}
                required
              />
              <Select
                name="kind"
                label="商品の種類"
                options={["coins", "subscription"]}
                value={editing.kind}
              />
              <Field
                name="amount"
                label="日本向けの設定価格（円・照合と集計用）"
                type="number"
                min={100}
                max={1000000}
                value={editing.amount}
                required
              />
              <Field
                name="credits"
                label="付与コイン数（coinsの場合）"
                type="number"
                min={1}
                max={1000000}
                value={editing.credits ?? 500}
              />
              <label className="field">
                <span>対象プラン（subscriptionの場合）</span>
                <select name="planId" defaultValue={editing.planId}>
                  {state.plans
                    .filter((p) => p.price > 0)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <Select
                name="period"
                label="契約期間"
                value={editing.period ?? "month"}
                options={["month", "year"]}
              />
              <Select
                name="published"
                label="ストア商品の公開"
                options={["非公開", "公開"]}
                value={editing.published ? "公開" : "非公開"}
              />
              <Field name="reason" label="ストア設定の変更理由" required />
            </Form>
          )}
        </>
      )}
    </Panel>
  );
}
