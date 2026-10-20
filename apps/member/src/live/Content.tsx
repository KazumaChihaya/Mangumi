import React, { useState } from "react";
import { api, upload } from "../api";
import { useStore } from "../store";
import { Button, Field, Form, Notice, Panel, Select, Table } from "../ui";
import { useResource } from "./hooks";
import { datetimeInput } from "../dates";
export function LiveStoriesAdmin() {
  const { state, refresh, notify } = useStore();
  const analytics = useResource<any[]>("/admin/story-analytics", 0);
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
              notify: values.notify === "通知する",
              ...(values.link ? { link: values.link } : {}),
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
            await analytics.reload();
            notify("ストーリーを保存しました");
          }}
        >
          <Field name="title" label="ストーリーの本文" multiline required />
          <Field name="link" label="リンク先（HTTPS・任意）" type="url" />
          <Select
            name="notify"
            label="公開時の通知"
            options={["通知する", "通知しない"]}
          />
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
      <Panel title="閲覧集計">
        <Table
          columns={["ストーリー", "状態", "閲覧者数"]}
          rows={(analytics.data ?? []).map((s) => [
            s.title,
            s.status,
            s.viewers,
          ])}
        />
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
                        after: {
                          ...story,
                          status: values.status,
                          title: values.title,
                          plan: values.plan,
                          highlight: values.highlight === "残す",
                          notify: values.notify === "通知する",
                          publishAt: new Date(values.publishAt).toISOString(),
                          expiresAt: new Date(values.expiresAt).toISOString(),
                          ...(values.link
                            ? { link: values.link }
                            : { link: undefined }),
                        },
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
                await analytics.reload();
              }}
            >
              <Field
                name="title"
                label="本文"
                value={story.title}
                multiline
                required
              />
              <Select
                name="plan"
                label="対象プラン"
                value={story.plan}
                options={state.plans.map((p) => p.name)}
              />
              <Select
                name="highlight"
                label="ハイライト"
                value={story.highlight ? "残す" : "残さない"}
                options={["残す", "残さない"]}
              />
              <Select
                name="notify"
                label="公開時の通知"
                value={
                  (story as any).notify === false ? "通知しない" : "通知する"
                }
                options={["通知する", "通知しない"]}
              />
              <Field
                name="publishAt"
                label="公開日時"
                type="datetime-local"
                value={datetimeInput((story as any).publishAt)}
                required
              />
              <Field
                name="expiresAt"
                label="終了日時"
                type="datetime-local"
                value={datetimeInput((story as any).expiresAt)}
                required
              />
              <Field
                name="link"
                label="リンク先"
                type="url"
                value={(story as any).link}
              />
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
  const versions = useResource("/admin/gacha/versions", 0);
  const campaigns = useResource<any[]>("/admin/gacha/campaigns", 0);
  const [editingCampaign, setEditingCampaign] = useState<any>();
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
      <Panel title="追加キャンペーン">
        <Notice>
          通常ガチャと並行して公開できます。キャンペーンごとに適用済みの確率版を固定します。
        </Notice>
        {campaigns.data?.map((c) => (
          <Button key={c.id} tone="ghost" onClick={() => setEditingCampaign(c)}>
            {c.title} · {c.status}
          </Button>
        ))}
        <Button tone="ghost" onClick={() => setEditingCampaign(undefined)}>
          新しいキャンペーン
        </Button>
        <Form
          key={editingCampaign?.id ?? "new-campaign"}
          submit="追加キャンペーンを保存"
          onSubmit={async (v) => {
            await api("/admin/gacha/campaigns", {
              campaign: {
                ...(editingCampaign ? { id: editingCampaign.id } : {}),
                title: v.title,
                status: v.status,
                start: v.start,
                end: v.end,
                plan: v.plan,
                description: v.description,
                oddsVersion: v.oddsVersion,
                ticketCost: Number(v.ticketCost),
                maxBatch: Number(v.maxBatch),
                dailyTickets: Number(v.dailyTickets),
                maxPerUser: Number(v.maxPerUser),
              },
              reason: v.reason,
            });
            await campaigns.reload();
            notify("キャンペーンを保存しました");
          }}
        >
          <Field
            name="title"
            label="キャンペーン名"
            value={editingCampaign?.title}
            required
          />
          <Field
            name="description"
            label="説明"
            value={editingCampaign?.description}
            multiline
          />
          <Field
            name="start"
            label="開始日（日本時間）"
            type="date"
            value={editingCampaign?.start}
            required
          />
          <Field
            name="end"
            label="終了日（日本時間）"
            type="date"
            value={editingCampaign?.end}
            required
          />
          <Select
            name="status"
            label="公開状態"
            options={["下書き", "公開", "停止", "終了"]}
            value={editingCampaign?.status}
          />
          <Select
            name="plan"
            label="対象プラン"
            options={state.plans.map((p) => p.name)}
            value={editingCampaign?.plan}
          />
          <Select
            name="oddsVersion"
            label="確率版"
            options={[
              versions.data?.current?.version,
              ...(versions.data?.history ?? []).map((v: any) => v.version),
            ].filter(Boolean)}
            value={editingCampaign?.oddsVersion}
          />
          <Field
            name="ticketCost"
            label="1回に必要なチケット"
            type="number"
            min={1}
            max={100}
            value={editingCampaign?.ticketCost ?? 1}
            required
          />
          <Field
            name="maxBatch"
            label="一度に引ける回数"
            type="number"
            min={1}
            max={10}
            value={editingCampaign?.maxBatch ?? 10}
            required
          />
          <Field
            name="dailyTickets"
            label="毎日の無料チケット"
            type="number"
            min={0}
            max={100}
            value={editingCampaign?.dailyTickets ?? 0}
            required
          />
          <Field
            name="maxPerUser"
            label="1人の期間中上限"
            type="number"
            min={1}
            value={editingCampaign?.maxPerUser ?? 10000}
            required
          />
          <Field name="reason" label="変更理由" required />
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
        {items.map((prize, index) => (
          <details key={prize.id ?? index}>
            <summary>{prize.title}の在庫と編集</summary>
            <label className="field">
              <span>在庫総数（空欄は無制限、配布済みの数量以上）</span>
              <input
                type="number"
                min={0}
                value={prize.stock ?? ""}
                onChange={(e) => {
                  const next = structuredClone(items);
                  next[index].stock =
                    e.target.value === "" ? undefined : Number(e.target.value);
                  setDraft(next);
                }}
              />
            </label>
            <Button
              tone="danger"
              onClick={() => setDraft(items.filter((_, n) => n !== index))}
            >
              編集リストから外す
            </Button>
          </details>
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
      <Panel title="提供割合の予約と履歴">
        <Form
          submit="編集中の提供割合を予約"
          onSubmit={async (v) => {
            await api("/admin/gacha/versions", {
              items,
              effectiveAt: new Date(v.effectiveAt).toISOString(),
              reason: v.reason,
            });
            await versions.reload();
          }}
        >
          <Field
            name="effectiveAt"
            label="適用開始日時"
            type="datetime-local"
            required
          />
          <Field name="reason" label="変更理由" required />
        </Form>
        <p>現在の版：{versions.data?.current?.version}</p>
        <Table
          columns={["版", "適用日時", "状態"]}
          rows={[
            ...(versions.data?.history ?? []).map((v: any) => [
              v.version,
              v.at,
              "過去の版",
            ]),
            ...(versions.data?.scheduled ?? []).map((v: any) => [
              v.id,
              v.effectiveAt,
              v.status,
            ]),
          ]}
        />
        {versions.data?.scheduled
          ?.filter((v: any) => v.status === "予約")
          .map((v: any) => (
            <Form
              key={v.id}
              submit="この予約を取り消す"
              tone="danger"
              onSubmit={async (values) => {
                await api(`/admin/gacha/versions/${v.id}/cancel`, values);
                await versions.reload();
              }}
            >
              <p>
                {v.effectiveAt} · {v.id}
              </p>
              <Field name="reason" label="取消理由" required />
            </Form>
          ))}
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
