import React, { useEffect } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useStore } from "../store";
import { screenPath, type Screen } from "../registry";
import { Button, Empty, Notice, Panel } from "../ui";
import { OfficialStory } from "./Official";
export function LiveStories({ screen }: { screen: Screen }) {
  const { state, update, notify, refresh } = useStore();
  const query = useLocalSearchParams<{ item?: string }>();
  const router = useRouter();
  const detail = ["U035", "U036", "U037", "U039"].includes(screen.id);
  const story =
    state.stories.find((story) => story.id === query.item) ?? state.stories[0];
  useEffect(() => {
    if (detail && story && !story.viewed)
      void update((draft) => {
        const item = draft.stories.find((item) => item.id === story.id);
        if (item) item.viewed = true;
      }).catch((error) => notify(error.message));
    if (!detail || !story) return;
    const expiry = (story as any).expiresAt;
    if (!expiry || story.highlight) return;
    const timer = setTimeout(
      () => {
        void refresh().catch(() => {});
      },
      Math.max(0, Math.min(2147483647, Date.parse(expiry) - Date.now() + 1000)),
    );
    return () => clearTimeout(timer);
  }, [detail, story?.id]);
  if (!story)
    return (
      <>
        <OfficialStory />
        <Panel>
          <Empty
            title="公開中のストーリーはありません"
            text="次回の更新をお楽しみに。"
          />
        </Panel>
      </>
    );
  if (!detail)
    return (
      <>
        <OfficialStory />
        <Panel title="マン組のストーリー">
          <div className="image-grid">
            {state.stories.map((item) => (
              <button
                className="image-card"
                key={item.id}
                onClick={() =>
                  router.push(
                    (screenPath("U035") +
                      `?item=${encodeURIComponent(item.id)}`) as Href,
                  )
                }
              >
                {(item as any).mediaType === "video" ? (
                  <video
                    src={item.image}
                    muted
                    playsInline
                    preload="metadata"
                    style={{
                      width: "100%",
                      maxHeight: 200,
                      objectFit: "contain",
                    }}
                    aria-label={item.title}
                  />
                ) : (
                  <img src={item.image} alt={item.title} />
                )}
                <strong>{item.title}</strong>
                <small>
                  {item.viewed ? "閲覧済み" : "NEW"}
                  {item.highlight ? " · ハイライト" : ""}
                </small>
              </button>
            ))}
          </div>
        </Panel>
      </>
    );
  const index = state.stories.findIndex((item) => item.id === story.id);
  return (
    <>
      <Panel title={story.title}>
        {(story as any).mediaType === "video" ? (
          <video
            controls
            playsInline
            src={story.image}
            style={{ width: "100%", maxHeight: "65vh", objectFit: "contain" }}
          />
        ) : (
          <img
            src={story.image}
            alt={story.title}
            style={{ width: "100%", maxHeight: "65vh", objectFit: "contain" }}
          />
        )}
        <p>{story.title}</p>
        {(story as any).link && (
          <a
            className="button primary"
            href={(story as any).link}
            target="_blank"
            rel="noopener noreferrer"
          >
            リンクを開く
          </a>
        )}
        <Notice>
          {story.highlight ? "ハイライトとして公開中" : "期間限定のストーリー"}
        </Notice>
        <div className="button-row">
          {index > 0 && (
            <Button
              onClick={() =>
                router.replace(
                  (screenPath("U035") +
                    `?item=${state.stories[index - 1].id}`) as Href,
                )
              }
            >
              前へ
            </Button>
          )}
          {index < state.stories.length - 1 && (
            <Button
              onClick={() =>
                router.replace(
                  (screenPath("U035") +
                    `?item=${state.stories[index + 1].id}`) as Href,
                )
              }
            >
              次へ
            </Button>
          )}
        </div>
      </Panel>
      <Button id="U034" tone="ghost">
        一覧へ戻る
      </Button>
    </>
  );
}
