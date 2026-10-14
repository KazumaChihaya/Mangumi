import React, { useRef, useState } from "react";
import { publicPath } from "../web-path";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { screenPath, type Screen } from "../registry";
import { useStore } from "../store";
import { yen } from "../model";
import {
  Badge,
  Button,
  Confirm,
  Empty,
  Field,
  Form,
  Hero,
  Notice,
  Panel,
  RouteLink,
  Row,
  Select,
  Toggle,
} from "../ui";
export function AccountPage({ screen }: { screen: Screen }) {
  const { item } = useLocalSearchParams<{ item?: string }>();
  const { state, update, notify, reset } = useStore();
  const router = useRouter();
  const [error, setError] = useState("");
  const [avatar, setAvatar] = useState(state.profile.avatar);
  const [scale, setScale] = useState(1);
  const imageRef = useRef<HTMLImageElement>(null);
  const go = (id: string) => router.push(screenPath(id) as Href);
  if (screen.id === "U088")
    return (
      <>
        <Hero
          asset="hero_profile"
          label="MY FAN CLUB"
          title="あなたも、マン組の一員。"
        />
        <Panel>
          <div className="profile-summary">
            <img
              src={publicPath(state.profile.avatar)}
              className="avatar-large"
              alt="あなたのプロフィール"
            />
            <div>
              <h2>{state.profile.name}</h2>
              <p>{state.profile.email}</p>
              <Badge>{state.profile.plan} MEMBER</Badge>
            </div>
          </div>
          <Row title="プロフィールを編集" id="U091" />
          <Row title="プランと特典" sub={state.profile.plan} id="U089" />
          <Row title="通知設定" id="U090" />
        </Panel>
        <Panel title="あなたの楽しみ">
          <Row
            title="コレクション"
            sub={`${state.draws.length}アイテム`}
            id="U084"
          />
          <Row
            title="無料チケット・抽選履歴"
            sub={`残り${state.tickets}枚`}
            id="U086"
          />
          <Row title="支払方法・応援履歴" id="U066" />
          <Row title="利用履歴" id="U100" />
        </Panel>
        <Panel title="アカウントとサポート">
          <Row title="公開範囲" id="U093" />
          <Row title="ブロック一覧" id="U097" />
          <Row title="ログイン中の端末" id="U098" />
          <Row title="ホーム画面に追加" id="U001" />
          <Row title="お問い合わせ・ヘルプ" id="U101" />
          <Row title="退会について" id="U102" />
        </Panel>
        <Button id="U099" tone="ghost">
          ログアウト
        </Button>
      </>
    );
  if (screen.id === "U091")
    return (
      <Panel title="プロフィールを編集">
        <Form
          onSubmit={(v) => {
            if (v.name.trim().length < 2 || v.name.trim().length > 30) {
              setError("ニックネームは2〜30文字にしてください");
              return;
            }
            update((d) => {
              d.profile.name = v.name.trim();
              d.profile.gender = v.gender;
            });
            notify("プロフィールを保存しました");
            go("U088");
          }}
        >
          <div className="profile-summary">
            <img
              src={publicPath(state.profile.avatar)}
              className="avatar-large"
              alt="プロフィール"
            />
            <Button id="U092" tone="ghost">
              写真を変更
            </Button>
          </div>
          <Field
            label="ニックネーム"
            name="name"
            value={state.profile.name}
            required
          />
          <Select
            label="性別"
            name="gender"
            value={state.profile.gender}
            options={["回答しない", "男性", "女性", "その他"]}
          />
          <Notice>
            性別は初期設定では非公開です。公開範囲は別の画面で変更できます。
          </Notice>
          <RouteLink id="U015" className="underlined">
            メールアドレスを変更
          </RouteLink>
          {error && <Notice tone="error">{error}</Notice>}
        </Form>
      </Panel>
    );
  if (screen.id === "U092")
    return (
      <>
        <Panel title="プロフィール写真">
          <div className="upload-box">
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: "50%",
                overflow: "hidden",
                border: "3px solid #d5a364",
              }}
            >
              <img
                ref={imageRef}
                src={publicPath(avatar)}
                alt="切り抜きプレビュー"
                style={{
                  width: "100%",
                  height: "100%",
                  transform: `scale(${scale})`,
                }}
              />
            </div>
            <input
              aria-label="プロフィール写真をアップロード"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (
                  !/^image\/(jpeg|png|webp)$/.test(file.type) ||
                  file.size > 5 * 1024 * 1024
                ) {
                  setError("JPEG・PNG・WebPの5MB以下の画像を選んでください");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setAvatar(String(reader.result));
                  setScale(1);
                  setError("");
                };
                reader.readAsDataURL(file);
              }}
            />
            <label className="field">
              <span>拡大して切り抜き</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              />
            </label>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            className="full"
            onClick={() => {
              const image = imageRef.current;
              if (!image?.complete) {
                setError("画像の読み込みを待ってください");
                return;
              }
              const canvas = document.createElement("canvas");
              canvas.width = 256;
              canvas.height = 256;
              const ctx = canvas.getContext("2d");
              if (!ctx) return;
              const side =
                Math.min(image.naturalWidth, image.naturalHeight) / scale;
              ctx.drawImage(
                image,
                (image.naturalWidth - side) / 2,
                (image.naturalHeight - side) / 2,
                side,
                side,
                0,
                0,
                256,
                256,
              );
              update((d) => {
                d.profile.avatar = canvas.toDataURL("image/jpeg", 0.86);
              });
              notify("プロフィール写真を保存しました");
              go("U091");
            }}
          >
            この写真を使う
          </Button>
        </Panel>
      </>
    );
  if (screen.id === "U093")
    return (
      <>
        <Panel title="公開範囲">
          <Toggle
            label="性別を公開する"
            description="初期設定では非公開です"
            checked={state.profile.publicGender}
            onChange={(value) =>
              update((d) => {
                d.profile.publicGender = value;
              })
            }
          />
          <Notice>
            メールアドレスは他の会員に公開しません。表示名とプロフィール写真は公開対象です。
          </Notice>
        </Panel>
        <Button id="U088" tone="gold">
          マイページへ
        </Button>
      </>
    );
  if (screen.id === "U090")
    return (
      <>
        <Panel title="受け取りたいお知らせ">
          <Toggle
            label="配信予定"
            description="開始前のリマインダー・予定の変更"
            checked={state.settings.notifySchedule}
            onChange={(value) =>
              update((d) => {
                d.settings.notifySchedule = value;
              })
            }
          />
          <Toggle
            label="ストーリー"
            description="マン組の新しい投稿"
            checked={state.settings.notifyStory}
            onChange={(value) =>
              update((d) => {
                d.settings.notifyStory = value;
              })
            }
          />
          <Toggle
            label="DM"
            description="公式メンバーからのメッセージ"
            checked={state.settings.notifyDM}
            onChange={(value) =>
              update((d) => {
                d.settings.notifyDM = value;
              })
            }
          />
          <Row
            title="配信リマインダーの時刻"
            sub={state.reminders.join("・")}
            id="U032"
          />
        </Panel>
        <Panel title="静かな時間">
          <Toggle
            label="サイレント時間帯"
            description="この時間は通常の通知を遅らせます"
            checked={state.settings.quiet}
            onChange={(value) =>
              update((d) => {
                d.settings.quiet = value;
              })
            }
          />
          <div className="field-grid">
            <Field
              label="開始"
              name="quiet-from"
              type="time"
              value={state.settings.quietFrom}
              onChange={(value) =>
                update((d) => {
                  d.settings.quietFrom = value;
                })
              }
            />
            <Field
              label="終了"
              name="quiet-to"
              type="time"
              value={state.settings.quietTo}
              onChange={(value) =>
                update((d) => {
                  d.settings.quietTo = value;
                })
              }
            />
          </div>
        </Panel>
        <Button onClick={() => notify("通知設定を保存しました")}>
          設定を保存
        </Button>
        <Button id="U017" tone="ghost">
          端末の通知許可を設定
        </Button>
      </>
    );
  if (screen.id === "U089")
    return (
      <>
        <Hero
          asset="hero_profile"
          label="FAN CLUB MEMBERSHIP"
          title="もっと、特別なマン組へ。"
        />
        <Notice>
          プラン名・料金・特典はデザイン確認用のサンプルです。初期公開はFreeのみを予定しています。
        </Notice>
        <div className="plan-grid">
          {state.plans.map((plan) => (
            <div
              className={`plan-card ${plan.name === "LEGEND" ? "featured" : ""}`}
              key={plan.id}
            >
              <div className="space-between">
                <h2>{plan.name}</h2>
                {state.profile.plan === plan.name && <Badge>加入中</Badge>}
              </div>
              <p className="price">
                {yen(plan.price)}
                <small> / 月（サンプル）</small>
              </p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <RouteLink id="U094" item={plan.id} className="button gold full">
                プランの詳細・確認
              </RouteLink>
            </div>
          ))}
        </div>
        <Button id="U096" tone="ghost">
          利用上限と特典
        </Button>
        <Button id="U095" tone="ghost">
          プランの解約について
        </Button>
      </>
    );
  if (screen.id === "U094")
    return (
      <Panel title="プラン変更をプレビュー">
        <Form
          submit="プレビューのプランを変更"
          onSubmit={(v) => {
            update(
              (d) => {
                d.profile.plan = v.plan;
              },
              "プラン変更プレビュー",
              state.profile.name,
            );
            notify(`${v.plan}の表示に切り替えました`);
            go("U088");
          }}
        >
          <Select
            label="確認するプラン"
            name="plan"
            value={
              state.plans.find((p) => p.id === item)?.name ?? state.profile.plan
            }
            options={state.plans.map((p) => p.name)}
          />
          <Notice>
            実際の契約や請求は発生しません。選択したプランの表示を確認できます。
          </Notice>
          <label className="check-row">
            <input type="checkbox" required />
            プレビューであることを確認しました
          </label>
        </Form>
      </Panel>
    );
  if (screen.id === "U095")
    return (
      <Confirm
        title="Freeプランに戻しますか？"
        text="プレビューのプランをFreeへ変更します。実際の契約の解約は行いません。"
        action="Freeへ変更"
        back="U089"
        onConfirm={() => {
          update(
            (d) => {
              d.profile.plan = "Free";
            },
            "Freeへ変更",
            state.profile.name,
          );
          notify("Freeプランに変更しました");
          go("U088");
        }}
      />
    );
  if (screen.id === "U096")
    return (
      <>
        <Panel title={`${state.profile.plan}の特典`}>
          <Row
            title="配信カレンダー"
            sub="閲覧可能"
            end={<Badge>利用OK</Badge>}
          />
          <Row
            title="音声メッセージ"
            sub={`1件 ${state.settings.audioSeconds}秒まで / 20MB`}
            end={<Badge>上限</Badge>}
          />
          <Row
            title="スペース"
            sub={`ルーム上限 ${state.settings.roomLimit}人`}
            end={<Badge>上限</Badge>}
          />
          <Row
            title="無料チケット"
            sub={`現在 ${state.tickets}枚`}
            end={<Badge>GACHA</Badge>}
          />
        </Panel>
        <Button id="U089" tone="gold">
          他のプランを確認
        </Button>
      </>
    );
  if (screen.id === "U097")
    return (
      <Panel title="ブロックした相手">
        {state.blocked ? (
          <Row
            title="まんぞう"
            sub="ブロック中"
            image="/assets/avatar.jpg"
            end={
              <Button
                tone="ghost"
                className="small"
                onClick={() => {
                  update((d) => {
                    d.blocked = false;
                  });
                  notify("ブロックを解除しました");
                }}
              >
                解除する
              </Button>
            }
          />
        ) : (
          <Empty
            icon="shield"
            title="ブロック中の相手はいません"
            text="安心してマン組のコミュニティをお楽しみください。"
          />
        )}
      </Panel>
    );
  if (screen.id === "U098")
    return (
      <>
        <Panel title="ログイン中の端末">
          {state.sessions.map((session) => (
            <Row
              key={session.id}
              title={session.name}
              sub={session.location}
              end={
                session.current ? (
                  <Badge>この端末</Badge>
                ) : (
                  <button
                    className="button ghost small"
                    onClick={() => {
                      update((d) => {
                        d.sessions = d.sessions.filter(
                          (s) => s.id !== session.id,
                        );
                      });
                      notify("端末のプレビューセッションを終了しました");
                    }}
                  >
                    ログアウト
                  </button>
                )
              }
            />
          ))}
        </Panel>
        <Button id="U099" tone="danger">
          すべての端末からログアウト
        </Button>
      </>
    );
  if (screen.id === "U099")
    return (
      <Confirm
        title="ログアウトしますか？"
        text="このプレビューセッションを終了し、ログイン画面へ戻ります。"
        action="ログアウト"
        back="U098"
        onConfirm={() => {
          update((d) => {
            d.profile.signedIn = false;
            d.sessions = [];
          });
          go("U012");
        }}
      />
    );
  if (screen.id === "U100")
    return (
      <>
        <Panel title="ガチャの履歴">
          {state.draws.length ? (
            state.draws
              .slice(0, 5)
              .map((d) => (
                <Row
                  key={d.id}
                  title={d.title}
                  sub="無料チケット1枚を使用"
                  id="U085"
                  item={d.id}
                />
              ))
          ) : (
            <p className="readable-text">まだ抽選していません。</p>
          )}
        </Panel>
        <Panel title="応援の履歴">
          {state.tips.length ? (
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
            <p className="readable-text">応援履歴はありません。</p>
          )}
        </Panel>
        <Panel title="お問い合わせ">
          {state.support.length ? (
            state.support.map((s) => (
              <Row
                key={s.id}
                title={s.subject}
                sub={s.status}
                end={<Badge>{s.status}</Badge>}
              />
            ))
          ) : (
            <p className="readable-text">送信したお問い合わせはありません。</p>
          )}
        </Panel>
      </>
    );
  if (screen.id === "U101")
    return (
      <>
        <Panel title="よくある質問">
          {[
            [
              "通知が届かない",
              "ホーム画面への追加と端末の通知許可をご確認ください。通知設定やサイレント時間帯も確認できます。",
            ],
            [
              "配信はどこで見る？",
              "配信予定の詳細からYouTubeなどの配信先へ移動できます。",
            ],
            [
              "無料チケットについて",
              "キャンペーンやプランの特典で配布されます。購入・換金・譲渡はできません。",
            ],
            [
              "不適切なメッセージが届いた",
              "会話の通報・ブロックから運営へお知らせください。",
            ],
          ].map(([q, a]) => (
            <details className="related-pages" key={q}>
              <summary>{q}</summary>
              <p className="readable-text">{a}</p>
            </details>
          ))}
        </Panel>
        <Panel title="お問い合わせ">
          <Form
            submit="問い合わせをプレビューに追加"
            onSubmit={(v) => {
              update((d) => {
                d.support.unshift({
                  id: crypto.randomUUID(),
                  subject: v.subject,
                  body: v.body,
                  status: "受付済み",
                });
              });
              notify("お問い合わせを追加しました。管理画面で確認できます");
            }}
          >
            <Field label="件名" name="subject" required />
            <Field label="お問い合わせ内容" name="body" multiline required />
            <Notice>
              プレビュー内の受付です。運営への実送信は行いません。
            </Notice>
          </Form>
        </Panel>
      </>
    );
  return (
    <Confirm
      title="退会について"
      text="退会フローのプレビューです。このブラウザ内の会員データと会話をクリアします。実際のアカウント削除は行いません。"
      action="プレビューの会員データを削除"
      back="U088"
      reason
      onConfirm={() => {
        update((d) => {
          d.profile = {
            ...d.profile,
            name: "",
            email: "",
            gender: "回答しない",
            avatar: "/assets/avatar.jpg",
            plan: "Free",
            verified: false,
            signedIn: false,
          };
          d.messages = [];
          d.sessions = [];
          d.tips = [];
          d.draws = [];
        });
        notify("プレビューの会員データを削除しました");
        go("U002");
      }}
    />
  );
}
