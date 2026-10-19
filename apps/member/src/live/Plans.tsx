import React, { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { Button, Field, Form, Panel, Select, Row } from "../ui";
import { yen } from "../model";
const features = [
  "配信予定",
  "ストーリー",
  "公式DM",
  "音声ルーム",
  "無料ガチャ",
  "投げ銭",
];
export function LivePlansAdmin() {
  const { state, refresh, notify } = useStore();
  const [editing, setEditing] = useState<any>();
  const [selected, setSelected] = useState<string[]>(features.slice(0, 5));
  return (
    <>
      <Panel title="プラン管理">
        {state.plans.map((plan) => (
          <Row
            key={plan.id}
            title={`${plan.name} · ${yen(plan.price)}/月`}
            end={
              <Button
                onClick={() => {
                  setEditing(plan);
                  setSelected(plan.features);
                }}
              >
                編集
              </Button>
            }
          />
        ))}
        <Button
          tone="ghost"
          onClick={() => {
            setEditing(undefined);
            setSelected(features.slice(0, 5));
          }}
        >
          新しいプラン
        </Button>
      </Panel>
      <Panel title={editing ? "プランを編集" : "プランを作成"}>
        <Form
          key={editing?.id ?? "new"}
          submit="プランを保存"
          onSubmit={async (values) => {
            const plan = {
              id: editing?.id ?? crypto.randomUUID(),
              name: values.name,
              description: values.description,
              price: Number(values.price),
              features: selected,
              published: values.published === "公開",
              trialDays: Number(values.trialDays || 0),
              dmPerDay: Number(values.dmPerDay),
              audioSeconds: Number(values.audioSeconds),
              gachaPerDay: Number(values.gachaPerDay),
              ...(values.yearPrice
                ? { yearPrice: Number(values.yearPrice) }
                : {}),
              ...(values.stripePrice
                ? { stripePrice: values.stripePrice }
                : {}),
              ...(values.stripeYearPrice
                ? { stripeYearPrice: values.stripeYearPrice }
                : {}),
              ...(values.opensAt
                ? { opensAt: new Date(values.opensAt).toISOString() }
                : {}),
              ...(values.closesAt
                ? { closesAt: new Date(values.closesAt).toISOString() }
                : {}),
            };
            await api(
              "/commands",
              {
                changes: [
                  {
                    resource: "plans",
                    id: plan.id,
                    before: editing,
                    after: plan,
                  },
                ],
                action: "プラン設定変更",
                reason: values.reason,
              },
              "POST",
              "admin",
              crypto.randomUUID(),
            );
            await refresh();
            setEditing(undefined);
            notify("プランを保存しました");
          }}
        >
          <Field name="name" label="プラン名" value={editing?.name} required />
          <Field
            name="description"
            label="特典の説明"
            value={editing?.description}
            multiline
          />
          <Field
            name="price"
            label="月額（円）"
            type="number"
            value={editing?.price ?? 0}
            min={0}
            required
          />
          <Field
            name="yearPrice"
            label="年額（円・任意）"
            type="number"
            value={editing?.yearPrice}
            min={0}
          />
          <Field
            name="stripePrice"
            label="Stripeの月額料金ID"
            value={editing?.stripePrice}
          />
          <Field
            name="stripeYearPrice"
            label="Stripeの年額料金ID"
            value={editing?.stripeYearPrice}
          />
          <Field
            name="trialDays"
            label="無料体験の日数"
            type="number"
            value={editing?.trialDays ?? 0}
            min={0}
            max={90}
          />
          {features.map((feature) => (
            <label className="check-row" key={feature}>
              <input
                type="checkbox"
                checked={selected.includes(feature)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, feature]
                      : selected.filter((value) => value !== feature),
                  )
                }
              />
              {feature}
            </label>
          ))}
          <Field
            name="dmPerDay"
            label="1日のDM送信上限"
            type="number"
            value={editing?.dmPerDay ?? 100}
            min={0}
            required
          />
          <Field
            name="audioSeconds"
            label="音声メッセージの上限秒数"
            type="number"
            value={editing?.audioSeconds ?? 300}
            min={1}
            max={300}
            required
          />
          <Field
            name="gachaPerDay"
            label="1日の抽選上限"
            type="number"
            value={editing?.gachaPerDay ?? 100}
            min={0}
            required
          />
          <Select
            name="published"
            label="公開状態"
            options={["公開", "非公開"]}
            value={editing?.published === false ? "非公開" : "公開"}
          />
          <Field name="opensAt" label="申込開始日時" type="datetime-local" />
          <Field name="closesAt" label="申込終了日時" type="datetime-local" />
          <Field name="reason" label="変更理由" required />
        </Form>
      </Panel>
      <Panel title="個別の利用権限">
        <Form
          submit="権限を適用"
          onSubmit={async (values) => {
            await api(`/admin/users/${values.userId}/overrides`, {
              feature: values.feature,
              allowed: values.allowed === "利用可",
              expiresAt: new Date(values.expiresAt).toISOString(),
              reason: values.reason,
            });
            notify("個別権限を保存しました");
          }}
        >
          <Field name="userId" label="対象会員ID" required />
          <Select
            name="feature"
            label="機能"
            options={[
              "calendar.view",
              "notification.receive",
              "story.view",
              "dm.send",
              "dm.audio.send",
              "voice.join",
              "voice.speak",
              "gacha.draw",
              "tip.send",
            ]}
          />
          <Select
            name="allowed"
            label="利用可否"
            options={["利用可", "利用不可"]}
          />
          <Field
            name="expiresAt"
            label="適用終了日時"
            type="datetime-local"
            required
          />
          <Field name="reason" label="理由" required />
        </Form>
      </Panel>
    </>
  );
}
