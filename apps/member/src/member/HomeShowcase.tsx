import React from "react";
import { useStore } from "../store";
import { publicPath } from "../web-path";
import { liveMode } from "../api";
import { Badge, Button, Icon, Notice, Panel, RouteLink, Row } from "../ui";

export function HomeShowcase({ freeOnly }: { freeOnly: boolean }) {
  const { state } = useStore();
  const first = state.schedules.find((schedule) => schedule.status === "公開");
  const room = state.rooms[0];
  const incoming = state.messages.filter((message) => !message.mine).length;
  return (
    <div className="home-showcase screen-body content-stagger">
      <div className="space-between home-welcome">
        <strong>WELCOME BACK, {state.profile.name}</strong>
        <RouteLink id="U001" className="back-link">
          <Icon name="download" size={14} />
          アプリを追加
        </RouteLink>
      </div>
      {first ? (
        <section className="broadcast-billboard" aria-label="次回の配信">
          <div className="billboard-label">
            <Icon name="play" size={18} />
            次回の配信
          </div>
          <div className="broadcast-grid">
            <RouteLink
              id="U029"
              item={first.id}
              className={`broadcast-photo ${first.image === "/assets/thumb_1.jpg" ? "reference-cover" : ""}`}
            >
              <img
                src={publicPath(
                  first.image === "/assets/thumb_1.jpg"
                    ? "/assets/mood-cabinet.png"
                    : first.image,
                )}
                alt={first.title}
              />
              <span>一緒に、最高の瞬間を。</span>
            </RouteLink>
            <div className="broadcast-copy">
              <span className="broadcast-date">
                {first.date.slice(5).replace("-", "月")}日
              </span>
              <strong className="broadcast-time">{first.time}〜</strong>
              <h2>{first.title}</h2>
              <Button id="U032" icon="bell">
                リマインド設定
              </Button>
            </div>
          </div>
          <div className="billboard-bottom">
            <span>マン組と、もっと熱く。</span>
            <RouteLink id="U028">配信予定をすべて見る ›</RouteLink>
          </div>
        </section>
      ) : (
        <Panel title="次回の配信">
          <p>新しい配信予定をお楽しみに！</p>
          <Button id="U028">配信カレンダーへ</Button>
        </Panel>
      )}
      <Panel
        title="お知らせ"
        className="home-notices"
        action={<RouteLink id="U023">すべて見る ›</RouteLink>}
      >
        {state.notices
          .filter((notice) => notice.status === "公開")
          .map((notice) => (
            <Row
              key={notice.id}
              title={notice.title}
              id="U024"
              item={notice.id}
              end={
                !notice.read ? (
                  <Badge tone="pink">NEW</Badge>
                ) : (
                  <Icon name="chevron" size={15} />
                )
              }
            />
          ))}
      </Panel>
      <div className="home-community-grid">
        {!freeOnly && room && (
          <Panel title="開催中の音声ルーム" className="space-live">
            <span className="live-label">
              <span className="live-dot" /> LIVE SPACE
            </span>
            <Row
              title={room.title}
              sub={`${room.host} · ${room.listeners}人が参加中`}
              image="/assets/avatar.jpg"
              id="U044"
            />
            <Button id="U044" icon="mic">
              今すぐ参加する
            </Button>
          </Panel>
        )}
        <Panel title="最新ストーリー">
          {liveMode && !state.stories.length && (
            <p>新しいストーリーの公開をお楽しみに。</p>
          )}
          <div className="story-strip">
            {state.stories
              .filter((story) => story.status === "公開")
              .map((story) => (
                <RouteLink
                  key={story.id}
                  id="U035"
                  item={story.id}
                  className={`story-avatar ${story.viewed ? "viewed" : ""}`}
                >
                  {(story as any).mediaType === "video" ? (
                    <video
                      src={publicPath(story.image)}
                      muted
                      playsInline
                      preload="metadata"
                      aria-label={story.title}
                      style={{
                        width: 60,
                        height: 60,
                        objectFit: "cover",
                        borderRadius: "50%",
                      }}
                    />
                  ) : (
                    <img src={publicPath(story.image)} alt={story.title} />
                  )}
                  <span>{story.title.slice(0, 8)}</span>
                </RouteLink>
              ))}
            {!liveMode && (
              <RouteLink id="U037" className="story-avatar">
                <img src={publicPath("/assets/avatar.jpg")} alt="ハイライト" />
                <span>ハイライト</span>
              </RouteLink>
            )}
          </div>
          <Button id="U034" tone="ghost">
            ストーリーを見る
          </Button>
        </Panel>
      </div>
      {!freeOnly && (
        <>
          <RouteLink id="U055" className="dm-neon">
            <Icon name="dm" size={29} />
            <div>
              <strong>マン組にDM</strong>
              <small>メッセージで、もっと近くに。</small>
            </div>
            {incoming > 0 && <Badge tone="pink">{incoming}</Badge>}
            <Icon name="chevron" />
          </RouteLink>
          <RouteLink id="U076" className="gacha-billboard">
            <img src={publicPath("/assets/hero_gacha.jpg")} alt="" />
            <small>ここでしか手に入らないコレクション</small>
            <strong>マン組限定ガチャ</strong>
            <span>
              今すぐガチャを引く <Icon name="chevron" size={18} />
            </span>
          </RouteLink>
        </>
      )}
      <div className="feature-grid home-shortcuts">
        <RouteLink id="U028" className="feature-card">
          <Icon name="calendar" size={22} />
          <strong>配信カレンダー</strong>
          <small>次のワクワクを。</small>
        </RouteLink>
        {!freeOnly && (
          <RouteLink id="U065" className="feature-card">
            <Icon name="heart" size={22} />
            <strong>マン組を応援</strong>
            <small>ありがとうをカタチに。</small>
          </RouteLink>
        )}
      </div>
      {freeOnly && (
        <Notice>
          Freeプランで配信予定と通知をご利用いただけます。新しい機能も順次公開予定です。
        </Notice>
      )}
    </div>
  );
}
