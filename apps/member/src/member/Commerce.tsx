import React, { useEffect, useRef, useState } from "react";
import { publicPath } from "../web-path";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { screenPath, type Screen } from "../registry";
import { useStore } from "../store";
import { api, liveMode } from "../api";
import { validateTip, yen } from "../model";
import { playCue } from "../sound";
import { useResource } from "../live/hooks";
import {
  Badge,
  Button,
  Empty,
  Field,
  Form,
  Hero,
  Icon,
  Notice,
  Panel,
  RouteLink,
  Row,
  Table,
} from "../ui";
export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <i
          key={i}
          style={
            {
              "--left": `${(i * 37) % 100}%`,
              "--color": ["#ffc873", "#ff518b", "#d388f4"][i % 3],
              "--delay": `${i * 0.04}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
export function GachaPage({ screen }: { screen: Screen }) {
  const { state, draw, notify, sound, reduced, refresh, selectCampaign } =
    useStore();
  const campaigns = useResource<any[]>(
    liveMode ? "/gacha/campaigns" : undefined,
    0,
  );
  const cost = state.gacha.ticketCost ?? 1;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const available =
    !liveMode ||
    (state.gacha.status === "公開" &&
      today >= state.gacha.start &&
      today <= state.gacha.end &&
      (!state.gacha.plan ||
        state.gacha.plan === "Free" ||
        state.gacha.plan === state.profile.plan));
  const router = useRouter();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const [spinning, setSpinning] = useState(false);
  const [confirm, setConfirm] = useState(0);
  const busy = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      busy.current = false;
    },
    [],
  );
  useEffect(() => {
    if (!confirm) return;
    const previous = document.activeElement as HTMLElement;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy.current) setConfirm(0);
      if (event.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      if (!buttons?.length) {
        event.preventDefault();
        return;
      }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [confirm]);
  const start = (count: number) => {
    if (busy.current) return;
    if (state.tickets < count * cost) {
      router.push(screenPath("U087") as Href);
      return;
    }
    busy.current = true;
    setSpinning(true);
    playCue("spin", sound);
    timer.current = setTimeout(
      async () => {
        try {
          await draw(count);
          playCue("win", sound);
          router.push(screenPath(count === 1 ? "U082" : "U083") as Href);
        } catch (error) {
          notify(
            error instanceof Error ? error.message : "抽選できませんでした",
          );
        } finally {
          busy.current = false;
          setSpinning(false);
        }
      },
      reduced ? 250 : 2000,
    );
  };
  if (screen.id === "U087")
    return (
      <>
        <Panel>
          <Empty
            icon="ticket"
            title="チケットをチェックしよう"
            text={`残り${state.tickets}枚です。チケットはキャンペーンやプランの特典で配布されます。`}
            action={
              <Button id="U077" tone="gold">
                キャンペーンを見る
              </Button>
            }
          />
        </Panel>
        <Notice>
          このガチャは無料チケットを使用します。チケットの購入・換金・譲渡はできません。
        </Notice>
      </>
    );
  if (screen.id === "U079")
    return (
      <>
        <Panel title="景品と提供割合">
          <Table
            columns={["レアリティ", "景品", "提供割合"]}
            rows={state.probabilities.map((prize) => [
              <Badge key={prize.title}>{prize.rarity}</Badge>,
              prize.title,
              `${prize.weight}%`,
            ])}
          />
          <p className="preview-note">確率バージョン：preview-v1 / 合計100%</p>
        </Panel>
        <Notice>
          各抽選は独立です。景品の換金、売買、譲渡はできません。
          {!liveMode && "この画面の抽選はUIの動作確認用です。"}
        </Notice>
        <Button id="U076" tone="gold">
          ガチャへ戻る
        </Button>
      </>
    );
  if (screen.id === "U077")
    return (
      <>
        <Hero
          asset="hero_gacha"
          label="FREE TICKET GACHA"
          title="ワクワク、回そう。"
          text="ここだけの写真やボイス。マン組の瞬間をコレクション。"
        />
        <Panel title="開催中のキャンペーン">
          <Row
            title={state.gacha.title}
            sub={`${state.gacha.start}〜${state.gacha.end}`}
            image="/assets/thumb_1.jpg"
            id="U078"
            end={<Badge>{state.gacha.status}</Badge>}
          />
        </Panel>
        <Button id="U084" tone="ghost">
          コレクション
        </Button>
      </>
    );
  if (screen.id === "U078")
    return (
      <>
        <Hero
          asset="hero_gacha"
          label="SPECIAL CAMPAIGN"
          title={state.gacha.title}
        />
        <Panel title="キャンペーン詳細">
          <dl className="detail-grid">
            <dt>開催期間</dt>
            <dd>
              {state.gacha.start}〜{state.gacha.end}
            </dd>
            <dt>対象</dt>
            <dd>全メンバー</dd>
            <dt>チケット</dt>
            <dd>1回につき1枚</dd>
            <dt>景品</dt>
            <dd>写真・ボイス・プロフィールフレーム</dd>
          </dl>
          <Row title="景品・提供割合を確認" id="U079" />
        </Panel>
        <Button id="U076" tone="gold">
          ガチャへ
        </Button>
      </>
    );
  if (["U082", "U083"].includes(screen.id)) {
    const results =
      screen.id === "U083" ? state.draws.slice(0, 5) : state.draws.slice(0, 1);
    return (
      <>
        {results.length ? (
          <>
            <div style={{ position: "relative" }}>
              <h2 className="win-heading">
                {results[0].rarity === "SSR" ? "SUPER LUCKY!" : "NICE GET!"}
              </h2>
              {!reduced && <Confetti />}
            </div>
            <div className={screen.id === "U083" ? "image-grid" : ""}>
              {results.map((result) => (
                <RouteLink
                  key={result.id}
                  id="U085"
                  item={result.id}
                  className="image-card win-card"
                >
                  <img
                    src={publicPath(result.image)}
                    alt={result.title}
                    style={{ height: screen.id === "U083" ? 125 : 230 }}
                  />
                  <div>
                    <Badge tone="gold">{result.rarity} GET!</Badge>
                    <h3>{result.title}</h3>
                    <p>コレクションに追加しました</p>
                  </div>
                </RouteLink>
              ))}
            </div>
            <Button id="U084" tone="gold">
              コレクションへ
            </Button>
            <Button id="U076" tone="ghost">
              もう一度楽しむ
            </Button>
          </>
        ) : (
          <Panel>
            <Empty
              icon="ticket"
              title="まだ抽選結果がありません"
              text="チケットでガチャを引くと、獲得したアイテムが表示されます。"
              action={<Button id="U076">ガチャを引く</Button>}
            />
          </Panel>
        )}
      </>
    );
  }
  if (screen.id === "U084")
    return (
      <>
        <div className="space-between">
          <h2>あなたのコレクション</h2>
          <Badge>{state.draws.length} GET</Badge>
        </div>
        {state.draws.length ? (
          <div className="image-grid">
            {state.draws.map((result) => (
              <RouteLink
                key={result.id}
                id="U085"
                item={result.id}
                className="image-card"
              >
                <img src={publicPath(result.image)} alt={result.title} />
                <div>
                  <Badge>{result.rarity}</Badge>
                  <h3>{result.title}</h3>
                </div>
              </RouteLink>
            ))}
          </div>
        ) : (
          <Panel>
            <Empty
              icon="star"
              title="最初のコレクションを手に入れよう"
              text="獲得した写真やボイスが、ここに並びます。"
              action={
                <Button id="U076" tone="gold">
                  ガチャへ
                </Button>
              }
            />
          </Panel>
        )}
      </>
    );
  if (screen.id === "U085") {
    const result = state.draws.find((d) => d.id === item) ?? state.draws[0];
    return result ? (
      <>
        <img
          src={publicPath(result.image)}
          className="schedule-cover"
          alt={result.title}
        />
        <Panel title={result.title}>
          <Badge>{result.rarity}</Badge>
          <dl className="detail-grid">
            <dt>獲得日</dt>
            <dd>{new Date(result.at).toLocaleDateString("ja-JP")}</dd>
            <dt>確率バージョン</dt>
            <dd>{result.version}</dd>
            <dt>種別</dt>
            <dd>
              {liveMode
                ? "デジタルコレクション"
                : "デジタルコレクション（プレビュー）"}
            </dd>
          </dl>
          {liveMode && result.assetId && (
            <Button
              onClick={async () => {
                const file = await api(`/media/${result.assetId}/url`, {});
                window.location.assign(file.url);
              }}
            >
              獲得した景品ファイルを開く
            </Button>
          )}
          {liveMode && result.kind === "frame" && result.assetId && (
            <Button
              onClick={async () => {
                await api(
                  "/me/frame",
                  { drawId: result.id },
                  "POST",
                  "member",
                  crypto.randomUUID(),
                );
                await refresh();
                notify("プロフィールにフレームを設定しました");
              }}
            >
              プロフィールにフレームを設定
            </Button>
          )}
          {!liveMode && (
            <Notice>
              景品の実ファイルは運営が登録したコンテンツへ接続して提供します。
            </Notice>
          )}
        </Panel>
        <Button id="U084" tone="ghost">
          コレクションへ戻る
        </Button>
      </>
    ) : (
      <Panel>
        <Empty
          icon="star"
          title="まだアイテムを獲得していません"
          text="ガチャからお気に入りのアイテムを見つけよう。"
          action={<Button id="U076">ガチャへ</Button>}
        />
      </Panel>
    );
  }
  if (screen.id === "U086")
    return (
      <>
        <Panel title="抽選履歴">
          {state.draws.length ? (
            state.draws.map((d) => (
              <Row
                key={d.id}
                title={d.title}
                sub={`${new Date(d.at).toLocaleString("ja-JP")} / チケット1枚 / ${d.version}`}
                image={d.image}
                id="U085"
                item={d.id}
                end={<Badge>{d.rarity}</Badge>}
              />
            ))
          ) : (
            <Empty
              icon="ticket"
              title="抽選履歴はありません"
              text="ガチャを引くと、使用チケットと景品を確認できます。"
            />
          )}
        </Panel>
        <Button id="U076" tone="ghost">
          ガチャへ戻る
        </Button>
      </>
    );
  if (screen.id === "U080")
    return (
      <Panel className="confirmation">
        <Empty
          icon="ticket"
          title={`チケットを${cost}枚使いますか？`}
          text={`残り${state.tickets}枚。無料チケットで1回抽選します。`}
        />
        <Button
          className="full"
          disabled={!available || spinning || state.tickets < cost}
          onClick={() => start(1)}
        >
          {spinning ? "抽選中…" : "確認してガチャを引く"}
        </Button>
        <Button id="U076" tone="ghost" className="full">
          キャンセル
        </Button>
      </Panel>
    );
  return (
    <>
      <div
        className={`slot-machine ${spinning ? "spinning" : ""}`}
        aria-busy={spinning}
      >
        <div className="slot-title">脳汁ガチャ</div>
        <div className="slot-kicker">MANZOU CHANCE</div>
        <div className="slot-reels">
          {["7", "★", "7"].map((symbol, i) => (
            <div className="slot-reel" key={i}>
              <span>{symbol}</span>
            </div>
          ))}
        </div>
        <p className="slot-sub">
          {spinning
            ? "その瞬間を、待ちわびて。"
            : "マン組スペシャルコレクション"}
        </p>
      </div>
      <Panel>
        {liveMode && !!campaigns.data?.length && (
          <label className="field">
            <span>キャンペーンを選ぶ</span>
            <select
              value={state.gacha.id ?? "global"}
              onChange={(e) =>
                void selectCampaign(e.target.value).catch((error) =>
                  notify(error.message),
                )
              }
            >
              {campaigns.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}（{c.start}〜{c.end}）
                </option>
              ))}
            </select>
          </label>
        )}
        {!available && (
          <Notice>
            現在、このプランで参加できるガチャは開催されていません。
          </Notice>
        )}
        {state.gacha.description && <p>{state.gacha.description}</p>}
        {liveMode && available && !!state.gacha.dailyTickets && (
          <Button
            onClick={async () => {
              await api(
                "/gacha/daily-tickets",
                { campaignId: state.gacha.id ?? "global" },
                "POST",
                "member",
                crypto.randomUUID(),
              );
              await refresh();
              notify("本日の無料チケットを受け取りました");
            }}
          >
            本日の無料チケットを受け取る · {state.gacha.dailyTickets}枚
          </Button>
        )}
        <div className="ticket-balance">
          <Icon name="ticket" size={25} />
          <span>無料チケット</span>
          <strong>{state.tickets}</strong>
          <span>枚</span>
        </div>
        <div className="button-row">
          <Button
            tone="gold"
            disabled={!available || spinning || state.tickets < cost}
            onClick={() => setConfirm(1)}
          >
            {spinning ? "抽選中…" : `1回引く · ${cost}枚`}
          </Button>
          <Button
            disabled={
              !available ||
              spinning ||
              state.tickets < 5 * cost ||
              (state.gacha.maxBatch ?? 10) < 5
            }
            onClick={() => setConfirm(5)}
          >
            5回引く · {5 * cost}枚
          </Button>
        </div>
        {confirm > 0 && (
          <div
            className="gacha-confirm"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="チケット使用確認"
            style={{ marginTop: 16 }}
          >
            <p>無料チケットを{confirm * cost}枚使って抽選します。</p>
            <div className="button-row" style={{ marginTop: 12 }}>
              <Button
                tone="ghost"
                disabled={spinning}
                onClick={() => setConfirm(0)}
              >
                キャンセル
              </Button>
              <Button
                tone="gold"
                disabled={spinning}
                onClick={() => start(confirm)}
              >
                {spinning ? "抽選中…" : "確認して引く"}
              </Button>
            </div>
          </div>
        )}
        <small className="preview-note">
          {liveMode
            ? "獲得した景品はコレクションから確認できます。"
            : "動作確認用の抽選です。実際の景品は付与されません。"}
        </small>
      </Panel>
      <div className="button-row">
        <Button id="U079" tone="ghost">
          景品・提供割合
        </Button>
        <Button id="U086" tone="ghost">
          抽選履歴
        </Button>
      </div>
      <Panel title="注目の景品">
        <div className="image-grid">
          {state.probabilities.slice(0, 2).map((p) => (
            <div className="image-card" key={p.title}>
              <img src={publicPath(p.image)} alt={p.title} />
              <div>
                <Badge>{p.rarity}</Badge>
                <h3>{p.title}</h3>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
export function TipPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const router = useRouter();
  const [error, setError] = useState("");
  const { item } = useLocalSearchParams<{ item?: string }>();
  const go = (id: string) => router.push(screenPath(id) as Href);
  const tip = state.tips.find((t) => t.id === item) ?? state.tips[0];
  if (screen.id === "U067")
    return (
      <>
        <Hero
          asset="hero_tip"
          label="SUPPORT MANZOU"
          title="ありがとうを、カタチに。"
        />
        <Panel title="応援する相手を選ぶ">
          {["まんぞう", "マン組"].map((name) => (
            <button
              key={name}
              className="row"
              style={{
                width: "100%",
                background: "none",
                color: "inherit",
                borderTop: 0,
                borderLeft: 0,
                borderRight: 0,
                textAlign: "left",
              }}
              onClick={async () => {
                await update((d) => {
                  d.tipRecipient = name;
                });
                go("U065");
              }}
            >
              <img
                src={publicPath("/assets/avatar.jpg")}
                className="row-image"
                alt=""
              />
              <span className="row-content">
                <strong>{name}</strong>
                <small>公式配信者</small>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </Panel>
      </>
    );
  if (["U066", "U074"].includes(screen.id))
    return (
      <>
        <Panel title="支払方法">
          <Row
            title={
              state.paymentMethod
                ? "テスト用の支払方法"
                : "支払方法は未登録です"
            }
            sub="カード情報はこのアプリに保存しません"
            id="U069"
          />
        </Panel>
        <Panel title={screen.id === "U074" ? "投げ銭の詳細" : "応援の履歴"}>
          {screen.id === "U074" && tip ? (
            <>
              <div className="payout-amount">{yen(tip.amount)}</div>
              <dl className="detail-grid">
                <dt>応援先</dt>
                <dd>{tip.recipient}</dd>
                <dt>状態</dt>
                <dd>{tip.status}</dd>
                <dt>日時</dt>
                <dd>{new Date(tip.at).toLocaleString("ja-JP")}</dd>
                <dt>メッセージ</dt>
                <dd>{tip.message || "メッセージなし"}</dd>
              </dl>
            </>
          ) : state.tips.length ? (
            state.tips.map((t) => (
              <Row
                key={t.id}
                title={`${t.recipient}へ ${yen(t.amount)}`}
                sub={t.status}
                id="U074"
                item={t.id}
              />
            ))
          ) : (
            <Empty
              icon="heart"
              title="応援履歴はありません"
              text="ありがとうの気持ちが、ここに並びます。"
            />
          )}
        </Panel>
        <Button id="U065" tone="gold">
          マン組を応援する
        </Button>
      </>
    );
  if (screen.id === "U069")
    return (
      <>
        <Panel title="支払方法の登録">
          <Empty
            icon="shield"
            title="カード情報は決済事業者へ"
            text="カード番号・CVCはまんぞうラブに保存しません。本番では決済事業者の専用入力フォームで登録します。"
          />
          <Notice>決済事業者は未接続です。実カードは登録できません。</Notice>
          <Button
            className="full"
            onClick={async () => {
              await update((d) => {
                d.paymentMethod = true;
              });
              notify("テスト用の支払方法を追加しました");
              go("U066");
            }}
          >
            テスト用支払方法を追加
          </Button>
          {state.paymentMethod && (
            <Button
              className="full"
              tone="danger"
              onClick={async () => {
                await update((d) => {
                  d.paymentMethod = false;
                });
                notify("テスト用支払方法を削除しました");
              }}
            >
              テスト用支払方法を削除
            </Button>
          )}
        </Panel>
      </>
    );
  if (screen.id === "U068")
    return (
      <>
        <Panel title="応援内容を確認">
          <div className="payout-amount">{yen(state.tipAmount)}</div>
          <dl className="detail-grid">
            <dt>応援先</dt>
            <dd>{state.tipRecipient}</dd>
            <dt>メッセージ</dt>
            <dd>{state.tipMessage || "なし"}</dd>
            <dt>支払方法</dt>
            <dd>テスト用支払方法</dd>
          </dl>
          <Notice>
            実際の決済は行いません。確認後、テスト結果の画面へ進みます。
          </Notice>
          <Form
            submit="テスト決済の確認へ"
            onSubmit={() => {
              if (!validateTip(state.tipAmount, state.settings.tipMax)) {
                setError("金額を確認してください");
                return;
              }
              go("U070");
            }}
          >
            <label className="check-row">
              <input type="checkbox" required />
              応援内容を確認しました
            </label>
            {error && <Notice tone="error">{error}</Notice>}
          </Form>
        </Panel>
        <Button id="U065" tone="ghost">
          内容を変更する
        </Button>
      </>
    );
  if (screen.id === "U070")
    return (
      <Panel>
        <Empty
          icon="shield"
          title="本人認証"
          text="本番では決済事業者による本人認証画面が表示されます。この画面は認証後の遷移プレビューです。"
          action={<Button id="U071">認証後の画面へ</Button>}
        />
      </Panel>
    );
  if (screen.id === "U071")
    return (
      <Panel>
        <Empty
          icon="heart"
          title="決済結果を確認"
          text="本番では署名検証済みWebhookで決済を確定します。このプレビューではテスト結果を作成できます。"
          action={
            <Button
              onClick={async () => {
                if (!validateTip(state.tipAmount, state.settings.tipMax)) {
                  notify("応援金額を確認してください");
                  go("U065");
                  return;
                }
                await update(
                  (d) => {
                    d.tips.unshift({
                      id: crypto.randomUUID(),
                      amount: d.tipAmount,
                      message: d.tipMessage,
                      recipient: d.tipRecipient,
                      status: "テスト完了",
                      at: new Date().toISOString(),
                    });
                  },
                  "投げ銭プレビュー",
                  state.tipRecipient,
                );
                go("U072");
              }}
            >
              テスト成功を表示
            </Button>
          }
        />
        <Button id="U073" tone="ghost" className="full">
          失敗・保留の画面を見る
        </Button>
      </Panel>
    );
  if (screen.id === "U072")
    return (
      <>
        <div style={{ position: "relative" }}>
          <h2 className="win-heading">THANK YOU!</h2>
          <Confetti />
        </div>
        <Panel>
          <Empty
            icon="heart"
            title="気持ちを届ける準備ができました"
            text="これはテスト完了画面です。実際の請求や配信者への送金は発生していません。"
          />
          <div className="payout-amount">
            {yen(tip?.amount ?? state.tipAmount)}
          </div>
        </Panel>
        <Button id="U066" tone="gold">
          応援履歴を見る
        </Button>
      </>
    );
  if (["U073", "U075"].includes(screen.id))
    return (
      <Panel>
        <Empty
          icon="shield"
          title={
            screen.id === "U075"
              ? "利用上限をご確認ください"
              : "決済は完了していません"
          }
          text={
            screen.id === "U075"
              ? `1回の応援金額は100円〜${yen(state.settings.tipMax)}です。`
              : "失敗、キャンセル、または結果待ちの状態です。確定状況を確認してから再度お試しください。"
          }
          action={
            <Button id="U065" tone="gold">
              内容を確認する
            </Button>
          }
        />
      </Panel>
    );
  return (
    <>
      <Hero
        asset="hero_tip"
        label="SUPPORT MANZOU"
        title="応援が、マン組のチカラに。"
        text="いつものありがとうも、今日の最高も。気持ちを届けよう。"
      />
      <Panel title="応援する相手">
        <Row
          title={state.tipRecipient}
          sub="マン組 公式配信者"
          image="/assets/avatar.jpg"
          id="U067"
        />
      </Panel>
      <Panel title="応援金額">
        <div className="amount-grid">
          {[100, 500, 1000, 3000, 5000, 10000].map((amount) => (
            <button
              key={amount}
              disabled={amount > state.settings.tipMax}
              className={state.tipAmount === amount ? "active" : ""}
              onClick={async () => {
                await update((d) => {
                  d.tipAmount = amount;
                });
                setError("");
              }}
            >
              {yen(amount)}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <Field
            name="custom-amount"
            label="好きな金額（円）"
            type="number"
            value={state.tipAmount}
            min={100}
            max={state.settings.tipMax}
            onChange={(value) =>
              update((d) => {
                d.tipAmount = Number(value);
              })
            }
          />
          <Field
            name="tip-message"
            label="応援メッセージ"
            value={state.tipMessage}
            placeholder="今日も最高でした！"
            multiline
            onChange={(value) =>
              update((d) => {
                d.tipMessage = value.slice(0, 500);
              })
            }
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </Panel>
      <Button
        icon="heart"
        onClick={() => {
          if (!validateTip(state.tipAmount, state.settings.tipMax)) {
            setError(
              `100円〜${yen(state.settings.tipMax)}の整数を入力してください`,
            );
            return;
          }
          go("U068");
        }}
      >
        応援内容を確認
      </Button>
      <Notice>
        決済接続前のプレビューです。実際のお支払いは発生しません。
      </Notice>
      <Button id="U066" tone="ghost">
        支払方法・応援履歴
      </Button>
    </>
  );
}
