import React, { useState } from "react";
import { api, upload } from "../api";
import { useStore } from "../store";
import { Field, Form, Panel, Select } from "../ui";
export function OfficialStory() {
  const { state, role, refresh, notify } = useStore();
  const [media, setMedia] = useState<{ url: string; video: boolean } | null>(
    null,
  );
  if (role !== "official") return null;
  return (
    <Panel title="公式ストーリーを投稿">
      <Form
        submit="投稿する"
        onSubmit={async (values) => {
          if (!media) throw new Error("画像・動画を選んでください");
          await api(
            "/official/stories",
            {
              title: values.title,
              image: media.url,
              mediaType: media.video ? "video" : "image",
              status: "公開",
              plan: values.plan,
              highlight: values.highlight === "ハイライトに残す",
              ...(values.publishAt
                ? { publishAt: new Date(values.publishAt).toISOString() }
                : {}),
            },
            "POST",
            "member",
          );
          setMedia(null);
          await refresh();
          notify("ストーリーを投稿しました");
        }}
      >
        <Field name="title" label="ストーリーの本文" required multiline />
        <label className="field">
          <span>画像・動画</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const video = file.type.startsWith("video/");
                const result = await upload(file, video ? "video" : "image");
                setMedia({ url: result.url, video });
              } catch (error) {
                notify((error as Error).message);
              }
            }}
          />
        </label>
        {media &&
          (media.video ? (
            <video
              controls
              src={media.url}
              style={{ width: "100%", maxHeight: 300, objectFit: "contain" }}
            />
          ) : (
            <img
              src={media.url}
              alt="投稿する画像"
              style={{ width: "100%", maxHeight: 300, objectFit: "contain" }}
            />
          ))}
        <Select
          name="plan"
          label="対象プラン"
          options={state.plans.map((plan) => plan.name)}
        />
        <Select
          name="highlight"
          label="公開終了後"
          options={["24時間で終了", "ハイライトに残す"]}
        />
        <Field
          name="publishAt"
          label="予約日時（空欄は即時）"
          type="datetime-local"
        />
      </Form>
    </Panel>
  );
}
export function OfficialRoom() {
  const { state, role, refresh, notify } = useStore();
  if (role !== "official") return null;
  return (
    <Panel title="音声ルームを開く">
      <Form
        submit="ルームを作成"
        onSubmit={async (values) => {
          await api("/official/voice-rooms", {
            title: values.title,
            plan: values.plan,
            maxSpeakers: Number(values.maxSpeakers),
            ...(values.startsAt
              ? { startsAt: new Date(values.startsAt).toISOString() }
              : {}),
          });
          await refresh();
          notify("ルームを作成しました");
        }}
      >
        <Field name="title" label="ルーム名" required />
        <Select
          name="plan"
          label="参加できるプラン"
          options={state.plans.map((plan) => plan.name)}
        />
        <Field
          name="maxSpeakers"
          label="登壇人数の上限"
          type="number"
          value={8}
          min={1}
          max={20}
        />
        <Field
          name="startsAt"
          label="開始予定（空欄は今すぐ）"
          type="datetime-local"
        />
      </Form>
    </Panel>
  );
}
