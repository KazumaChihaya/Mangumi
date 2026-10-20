import React, { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { Button, Field, Form, Panel, Select, Row } from "../ui";
import { yen } from "../model";
import { features as featureRegistry } from "../features";
import { useResource } from "./hooks";
import { datetimeInput } from "../dates";
import { LiveStoreProducts } from "./StoreProducts";
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
  const definitions = useResource<any[]>("/features", 0);
  const counts = useResource<Record<string, number>>("/admin/plan-counts", 0);
  const [editing, setEditing] = useState<any>();
  const [selected, setSelected] = useState<string[]>(features.slice(0, 5));
  return (
    <>
      <LiveStoreProducts />
      <Panel title="プラン管理">
        {state.plans.map((plan) => (
          <Row
            key={plan.id}
            title={`${plan.name} · ${yen(plan.price)}/月`}
            sub={`加入者 ${counts.data?.[plan.id] ?? 0}人`}
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
        {state.plans
          .filter((plan) => plan.name !== "Free")
          .map((plan) => (
            <details key={plan.id}>
              <summary>{plan.name}を削除</summary>
              <Form
                submit="このプランを削除"
                tone="danger"
                onSubmit={async (values) => {
                  await api(
                    "/commands",
                    {
                      changes: [
                        {
                          resource: "plans",
                          id: plan.id,
                          before: plan,
                          after: null,
                        },
                      ],
                      action: "プラン削除",
                      reason: values.reason,
                    },
                    "POST",
                    "admin",
                    crypto.randomUUID(),
                  );
                  await refresh();
                  await counts.reload();
                }}
              >
                <Field name="reason" label="削除理由" required />
                <label className="check-row">
                  <input type="checkbox" required />
                  所属会員がいないことを確認しました
                </label>
              </Form>
            </details>
          ))}
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
              color: values.color,
              badge: values.badge,
              order: Number(values.order),
              cancellation: values.cancellation,
              policies: Object.fromEntries(
                Object.keys(featureRegistry).map((key) => [
                  key,
                  {
                    allowed: values[`${key}.allowed`] === "利用可",
                    level: values[`${key}.level`],
                    ...Object.fromEntries(
                      [
                        "day",
                        "week",
                        "month",
                        "concurrent",
                        "created",
                        "bytes",
                        "seconds",
                        "retentionDays",
                      ]
                        .filter((field) => values[`${key}.${field}`] !== "")
                        .map((field) => [
                          field,
                          Number(values[`${key}.${field}`]),
                        ]),
                    ),
                    targets: values[`${key}.targets`]
                      .split(/[\s,]+/)
                      .filter(Boolean),
                  },
                ]),
              ),
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
          <Field
            name="opensAt"
            label="申込開始日時"
            type="datetime-local"
            value={datetimeInput(editing?.opensAt)}
          />
          <Field
            name="closesAt"
            label="申込終了日時"
            type="datetime-local"
            value={datetimeInput(editing?.closesAt)}
          />
          <Field name="reason" label="変更理由" required />
          <Field
            name="color"
            label="プランの色"
            type="color"
            value={(editing as any)?.color ?? "#ffd45c"}
          />
          <Field
            name="badge"
            label="バッジ"
            value={(editing as any)?.badge ?? ""}
          />
          <Field
            name="order"
            label="表示順"
            type="number"
            value={(editing as any)?.order ?? 0}
            min={0}
          />
          <Select
            name="cancellation"
            label="解約時の扱い"
            options={["period_end", "immediate"]}
            value={(editing as any)?.cancellation ?? "period_end"}
          />
          {Object.entries(featureRegistry).map(([key, label]) => {
            const policy = (editing as any)?.policies?.[key];
            const aliases: Record<string, string> = {
              "notification.receive": "配信予定",
              "dm.audio.send": "公式DM",
              "voice.speak": "音声ルーム",
              "voice.create": "音声ルーム",
            };
            return (
              <details key={key}>
                <summary>
                  {state.featureNames?.[key] ?? label}の権限・上限
                </summary>
                <Select
                  name={`${key}.allowed`}
                  label="利用可否"
                  options={["利用可", "利用不可"]}
                  value={
                    (policy?.allowed ??
                    (selected.includes(key) ||
                      selected.includes(aliases[key] ?? label)))
                      ? "利用可"
                      : "利用不可"
                  }
                />
                <Select
                  name={`${key}.level`}
                  label="権限レベル（閲覧・送信・作成・管理）"
                  options={["view", "send", "create", "manage"]}
                  value={policy?.level ?? "manage"}
                />
                {Object.entries({
                  day: "1日の回数",
                  week: "1週間の回数（月曜開始）",
                  month: "1か月の回数",
                  concurrent: "同時利用数",
                  created: "作成数",
                  bytes: "ファイル容量（バイト）",
                  seconds: "時間（秒）",
                  retentionDays: "保存期間（日）",
                }).map(([field, text]) => (
                  <Field
                    key={field}
                    name={`${key}.${field}`}
                    label={`${text}・空欄は追加制限なし`}
                    type="number"
                    min={
                      field === "bytes" ||
                      field === "seconds" ||
                      field === "retentionDays"
                        ? 1
                        : 0
                    }
                    value={policy?.[field]}
                  />
                ))}
                <Field
                  name={`${key}.targets`}
                  label="対象の公式配信者・キャンペーンID（カンマ区切り、空欄は全て）"
                  value={policy?.targets?.join(",") ?? ""}
                />
              </details>
            );
          })}
        </Form>
      </Panel>
      <Panel title="機能の表示名と説明">
        {definitions.data?.map((feature) => (
          <details key={feature.key}>
            <summary>
              {feature.name}（{feature.key}）
            </summary>
            <Form
              submit="機能説明を保存"
              onSubmit={async (v) => {
                await api("/admin/features", {
                  feature: {
                    key: feature.key,
                    name: v.name,
                    description: v.description,
                  },
                  reason: v.reason,
                });
                await definitions.reload();
              }}
            >
              <Field name="name" label="表示名" value={feature.name} required />
              <Field
                name="description"
                label="説明"
                value={feature.description}
                multiline
              />
              <Field name="reason" label="変更理由" required />
            </Form>
          </details>
        ))}
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
