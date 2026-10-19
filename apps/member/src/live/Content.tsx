import React, { useState } from "react";
import { api, upload } from "../api";
import { useStore } from "../store";
import { Button, Field, Form, Notice, Panel, Select, Table } from "../ui";
export function LiveStoriesAdmin() {
  const { state, refresh, notify } = useStore();
  const [image, setImage] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  return (
    <>
      <Panel title="ストーリーを投稿">
        <Form
          submit="ストーリーを保存"
          onSubmit={async (values) => {
            if (!image) throw new Error("画像をアップロードしてください");
            const publishAt = values.publishAt
              ? new Date(values.publishAt).toISOString()
              : new Date().toISOString();
            const story = {
              id: crypto.randomUUID(),
              title: values.title,
              image,
              mediaType,
              status: values.status,
              plan: values.plan,
              highlight: values.highlight === "ハイライトに残す",
              publishAt,
              expiresAt: values.expiresAt
                ? new Date(values.expiresAt).toISOString()
                : new Date(Date.parse(publishAt) + 86400000).toISOString(),
            };
            if (story.expiresAt <= story.publishAt)
              throw new Error("終了日時は公開日時より後にしてください");
            await api(
              "/commands",
              {
                changes: [{ resource: "stories", id: story.id, after: story }],
                action: "ストーリー作成",
                reason: "公式コンテンツの投稿",
              },
              "POST",
              "admin",
              crypto.randomUUID(),
            );
            await refresh();
            notify("ストーリーを保存しました");
          }}
        >
          <Field name="title" label="ストーリーの本文" multiline required />
          <label className="field">
            <span>画像・短い動画（20MB・60秒以内）</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  const video = file.type.startsWith("video/");
                  setImage((await upload(file, video ? "video" : "image")).url);
                  setMediaType(video ? "video" : "image");
                } catch (error) {
                  notify((error as Error).message);
                }
              }}
            />
          </label>
          {image && mediaType === "video" && (
            <video
              controls
              src={image}
              style={{ width: "100%", maxHeight: 300, objectFit: "contain" }}
            />
          )}
          {image && mediaType !== "video" && (
            <img
              src={image}
              alt="投稿する画像"
              style={{ width: "100%", maxHeight: 300, objectFit: "contain" }}
            />
          )}
          <Select name="status" label="公開状態" options={["下書き", "公開"]} />
          <Select
            name="plan"
            label="対象プラン"
            options={state.plans.map((plan) => plan.name)}
          />
          <Select
            name="highlight"
            label="公開終了後"
            options={["通常のストーリー", "ハイライトに残す"]}
          />
          <Field
            name="publishAt"
            label="公開日時（空欄は即時）"
            type="datetime-local"
          />
          <Field
            name="expiresAt"
            label="終了日時（空欄は24時間後）"
            type="datetime-local"
          />
        </Form>
      </Panel>
      <Panel title="ストーリー管理">
        {state.stories.map((story) => (
          <Panel key={story.id} title={story.title}>
            {(story as any).mediaType === "video" ? (
              <video
                src={story.image}
                controls
                preload="metadata"
                style={{ maxHeight: 200, width: "100%", objectFit: "contain" }}
              />
            ) : (
              <img
                src={story.image}
                alt={story.title}
                style={{ maxHeight: 200, width: "100%", objectFit: "contain" }}
              />
            )}
            <Form
              submit="公開状態を変更"
              onSubmit={async (values) => {
                await api(
                  "/commands",
                  {
                    changes: [
                      {
                        resource: "stories",
                        id: story.id,
                        before: story,
                        after: { ...story, status: values.status },
                      },
                    ],
                    action: "ストーリー公開変更",
                    reason: values.reason,
                  },
                  "POST",
                  "admin",
                  crypto.randomUUID(),
                );
                await refresh();
              }}
            >
              <Select
                name="status"
                label="公開状態"
                value={story.status}
                options={["下書き", "公開", "アーカイブ"]}
              />
              <Field name="reason" label="変更理由" required />
            </Form>
          </Panel>
        ))}
      </Panel>
    </>
  );
}
export function LiveGachaAdmin() {
  const { state, refresh, notify } = useStore();
  const [image, setImage] = useState("/assets/thumb_1.jpg");
  const [rewardFile, setRewardFile] = useState("");
  const [draft, setDraft] = useState<any[] | null>(null);
  const items = draft ?? state.probabilities;
  async function save(items: any[]) {
    await api(
      "/commands",
      {
        changes: [{ resource: "probabilities", after: items }],
        action: "提供割合を新しい版で保存",
        reason: "ガチャ景品と提供割合の更新",
      },
      "POST",
      "admin",
      crypto.randomUUID(),
    );
    setDraft(null);
    await refresh();
    notify("新しい提供割合を保存しました");
  }
  return (
    <>
      <Panel title="ガチャキャンペーン">
        <Form
          submit="キャンペーンを保存"
          onSubmit={async (values) => {
            await api(
              "/commands",
              {
                changes: [
                  {
                    resource: "gacha",
                    after: {
                      title: values.title,
                      status: values.status,
                      start: values.start,
                      end: values.end,
                      description: values.description,
                      plan: values.plan,
                      ticketCost: Number(values.ticketCost),
                      dailyTickets: Number(values.dailyTickets),
                      maxBatch: Number(values.maxBatch),
                      maxPerUser: Number(values.maxPerUser),
                    },
                  },
                ],
                action: "キャンペーン更新",
                reason: values.reason,
              },
              "POST",
              "admin",
              crypto.randomUUID(),
            );
            await refresh();
          }}
        >
          <Field
            name="title"
            label="キャンペーン名"
            value={state.gacha.title}
            required
          />
          <Field
            name="start"
            label="開始日"
            type="date"
            value={state.gacha.start}
            required
          />
          <Field
            name="end"
            label="終了日"
            type="date"
            value={state.gacha.end}
            required
          />
          <Select
            name="status"
            label="公開状態"
            value={state.gacha.status}
            options={["下書き", "公開", "停止"]}
          />
          <Field name="reason" label="変更理由" required />
          <Field
            name="description"
            label="キャンペーンの説明"
            multiline
            value={state.gacha.description}
          />
          <Select
            name="plan"
            label="対象プラン（Freeは全会員）"
            options={state.plans.map((plan) => plan.name)}
            value={state.gacha.plan ?? "Free"}
          />
          <Field
            name="ticketCost"
            label="1回に必要なチケット数"
            type="number"
            min={1}
            max={100}
            value={state.gacha.ticketCost ?? 1}
            required
          />
          <Field
            name="dailyTickets"
            label="毎日受け取れる無料チケット数"
            type="number"
            min={0}
            max={100}
            value={state.gacha.dailyTickets ?? 0}
            required
          />
          <Field
            name="maxBatch"
            label="一度に引ける回数の上限"
            type="number"
            min={1}
            max={10}
            value={state.gacha.maxBatch ?? 10}
            required
          />
          <Field
            name="maxPerUser"
            label="開催期間中の1人あたり抽選上限"
            type="number"
            min={1}
            value={state.gacha.maxPerUser ?? 10000}
            required
          />
        </Form>
      </Panel>
      <Panel title="景品を追加">
        <Form
          submit="景品を編集リストへ追加"
          onSubmit={(values) => {
            setDraft([
              ...items,
              {
                id: crypto.randomUUID(),
                title: values.title,
                rarity: values.rarity,
                weight: Number(values.weight),
                image,
                assetId: rewardFile || undefined,
                kind: values.kind,
                ...(values.stock ? { stock: Number(values.stock) } : {}),
              },
            ]);
          }}
        >
          <Field name="title" label="景品名" required />
          <Select
            name="kind"
            label="景品の種類"
            options={["photo", "voice", "frame"]}
          />
          <Select
            name="rarity"
            label="レアリティ"
            options={["SSR", "SR", "R", "N"]}
          />
          <Field name="weight" label="提供割合（%）" type="number" required />
          <Field name="stock" label="在庫数（空欄は無制限）" type="number" />
          <label className="field">
            <span>獲得者に渡すファイル（非公開）</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,audio/*"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setRewardFile(
                    (
                      await upload(
                        file,
                        file.type.startsWith("audio/")
                          ? "rewardAudio"
                          : "rewardImage",
                      )
                    ).id,
                  );
                  notify("景品ファイルを保存しました");
                } catch (error) {
                  notify((error as Error).message);
                }
              }}
            />
          </label>
          <label className="field">
            <span>景品の画像</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setImage((await upload(file, "image")).url);
                } catch (error) {
                  notify((error as Error).message);
                }
              }}
            />
          </label>
          <img
            src={image}
            alt="景品画像"
            style={{ maxHeight: 150, width: "100%", objectFit: "contain" }}
          />
        </Form>
      </Panel>
      <Panel title="提供割合の編集">
        {items.map((prize, index) => (
          <label className="field" key={prize.id ?? index}>
            <span>
              {prize.rarity} · {prize.title}
            </span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              aria-label={`${prize.title}の提供割合`}
              value={prize.weight}
              onChange={(event) => {
                const next = structuredClone(items);
                next[index].weight = Number(event.target.value);
                setDraft(next);
              }}
            />
          </label>
        ))}
        <Notice>
          合計{" "}
          {items.reduce(
            (sum, prize) => sum + Math.round(prize.weight * 100),
            0,
          ) / 100}
          % · 保存のたびに新しい版を作成します。
        </Notice>
        <Button onClick={() => save(items)}>
          合計100%の提供割合を保存する
        </Button>
      </Panel>
      <Panel title="抽選履歴">
        <Table
          columns={["日時", "景品", "確率版"]}
          rows={state.draws.map((draw) => [
            new Date(draw.at).toLocaleString("ja-JP"),
            draw.title,
            draw.version,
          ])}
        />
      </Panel>
    </>
  );
}
