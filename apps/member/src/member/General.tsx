import React, { useState } from "react";
import { HomeShowcase } from "./HomeShowcase";
import { publicPath } from "../web-path";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { screenPath, type Screen } from "../registry";
import { useStore } from "../store";
import {
  Badge,
  Button,
  Confirm,
  Empty,
  Field,
  Form,
  Hero,
  Icon,
  Notice,
  Panel,
  RouteLink,
  Row,
  Select,
  Toggle,
} from "../ui";

export function HomePage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const notice = state.notices.find((n) => n.id === item) ?? state.notices[0];
  if (["U024", "U026"].includes(screen.id))
    return (
      <>
        <Panel>
          <Badge>INFORMATION</Badge>
          <h2 style={{ margin: "14px 0" }}>{notice.title}</h2>
          <p className="readable-text">{notice.body}</p>
          <small className="preview-note">2026.10.13 / マン組運営</small>
        </Panel>
        <Button id="U028" tone="gold">
          配信予定を見る
        </Button>
        <Button id={screen.id === "U026" ? "U025" : "U023"} tone="ghost">
          一覧へ戻る
        </Button>
      </>
    );
  if (["U023", "U025"].includes(screen.id))
    return (
      <>
        <Panel
          title={
            screen.id === "U025" ? "あなたへのお知らせ" : "マン組からのお知らせ"
          }
          action={
            screen.id === "U025" && (
              <button
                className="button ghost small"
                onClick={() => {
                  update((d) => {
                    d.notices.forEach((n) => {
                      n.read = true;
                    });
                  });
                  notify("すべて既読にしました");
                }}
              >
                すべて既読
              </button>
            )
          }
        >
          {state.notices.map((n) => (
            <div
              key={n.id}
              onClick={() =>
                update((d) => {
                  d.notices.find((x) => x.id === n.id)!.read = true;
                })
              }
            >
              <Row
                title={n.title}
                sub={n.read ? "既読" : "NEW · 2026.10.13"}
                id={screen.id === "U025" ? "U026" : "U024"}
                item={n.id}
                end={
                  <Badge tone={n.read ? "gray" : "pink"}>
                    {n.read ? "READ" : "NEW"}
                  </Badge>
                }
              />
            </div>
          ))}
        </Panel>
      </>
    );
  return <HomeShowcase freeOnly={screen.id === "U027"} />;
}

export function IntroPage({ screen }: { screen: Screen }) {
  const [device, setDevice] = useState(screen.id === "U005" ? "PC" : "iPhone");
  if (screen.id === "U002")
    return (
      <>
        <Hero
          asset="hero_home"
          label="WELCOME TO MANZOU LOVE"
          title="マン組と、もっと近くに。"
          text="配信も、オフショットも、ここだけのトークも。最高のファン体験がはじまる。"
        />
        <div className="feature-grid">
          <div className="feature-card">
            <Icon name="calendar" />
            <strong>配信を逃さない</strong>
            <small>予定とリマインダー</small>
          </div>
          <div className="feature-card">
            <Icon name="heart" />
            <strong>マン組とつながる</strong>
            <small>ストーリー・スペース・DM</small>
          </div>
        </div>
        <Button id="U009" tone="gold">
          無料でファンクラブに参加
        </Button>
        <Button id="U012" tone="ghost">
          すでに会員の方はこちら
        </Button>
      </>
    );
  if (["U003", "U004"].includes(screen.id))
    return (
      <>
        <Notice>
          これは画面確認用の文面です。正式な条文は運営の確認後に掲載します。
        </Notice>
        <Panel
          title={
            screen.id === "U003"
              ? "利用規約（確認用）"
              : "プライバシーポリシー（確認用）"
          }
        >
          {(screen.id === "U003"
            ? [
                [
                  "サービスについて",
                  "まんぞうラブはマン組の配信やコンテンツを楽しむファン向けサービスです。",
                ],
                [
                  "コミュニティのルール",
                  "相手を尊重し、誹謗中傷、個人情報の公開、迷惑行為を行わないでください。問題があれば通報をご利用ください。",
                ],
                [
                  "コンテンツの取り扱い",
                  "画像、音声などの無断転載や第三者の権利を侵害する利用はお控えください。",
                ],
                [
                  "プランとお支払い",
                  "料金、解約条件、返金条件は申込み前に確認できるようにします。無料ガチャの景品を換金・売買することはできません。",
                ],
              ]
            : [
                [
                  "取得する情報",
                  "会員登録、プロフィール、サービス利用、通知の設定に必要な情報を取り扱います。",
                ],
                [
                  "利用目的",
                  "アカウント管理、コンテンツ提供、安全対策、お問い合わせへの対応のために利用します。",
                ],
                [
                  "安全管理と保存",
                  "管理者のアクセスを限定し、保管期間と削除の方法を定めます。",
                ],
                [
                  "開示・訂正・削除",
                  "ご自身の情報に関する相談は、お問い合わせ窓口からご連絡ください。",
                ],
              ]
          ).map(([title, body]) => (
            <div className="legal-section" key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          ))}
        </Panel>
        <Button id="U101" tone="ghost">
          お問い合わせ
        </Button>
      </>
    );
  if (screen.id === "U006")
    return (
      <Panel>
        <Empty
          icon="download"
          title="ブラウザ版でも楽しめます"
          text="ホーム画面への追加はSafariやChromeなどの対応ブラウザでお試しください。"
          action={
            <Button id="U022" tone="gold">
              ブラウザで続ける
            </Button>
          }
        />
      </Panel>
    );
  return (
    <>
      <Hero
        asset="hero_home"
        label="いつでもマン組と一緒に"
        title="ホーム画面に、マン組を。"
        text="アプリのように開ける。次の配信も、もっと楽しみに。"
      />
      <div className="tabs">
        {["iPhone", "Android", "PC"].map((d) => (
          <button
            key={d}
            className={device === d ? "active" : ""}
            onClick={() => setDevice(d)}
          >
            {d}
          </button>
        ))}
      </div>
      <Panel title={`${device}の追加手順`}>
        <div className="install-illustration">
          <div className="install-phone">
            <Icon name="heart" size={32} />
          </div>
          <Icon name="chevron" size={24} />
          <div className="install-phone">
            <Icon name="download" size={32} />
          </div>
        </div>
        <ol className="step-list">
          {(device === "iPhone"
            ? [
                [
                  "Safariで開く",
                  "iPhone / iPadのSafariでこのサイトを開きます。",
                ],
                ["共有ボタンをタップ", "ブラウザの共有メニューを開きます。"],
                [
                  "ホーム画面に追加",
                  "「ホーム画面に追加」を選んで「追加」を押します。",
                ],
              ]
            : device === "Android"
              ? [
                  ["Chromeで開く", "AndroidのChromeでこのサイトを開きます。"],
                  [
                    "メニューを開く",
                    "右上のメニューからインストールを選びます。",
                  ],
                  [
                    "インストールを確定",
                    "確認画面の「インストール」を押します。",
                  ],
                ]
              : [
                  [
                    "Chrome / Edgeで開く",
                    "対応ブラウザでまんぞうラブを開きます。",
                  ],
                  [
                    "インストールアイコンを選ぶ",
                    "アドレスバーのアイコン、またはメニューから追加します。",
                  ],
                  [
                    "アプリとして開く",
                    "デスクトップやアプリ一覧から起動できます。",
                  ],
                ]
          ).map(([title, text]) => (
            <li key={title}>
              <div>
                <strong>{title}</strong>
                <small>{text}</small>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      {screen.id === "U007" && (
        <Notice>
          通知を受け取る準備のため、ホーム画面への追加をおすすめします。
        </Notice>
      )}
      <Button id="U022" tone="gold">
        アプリを楽しむ
      </Button>
    </>
  );
}

export function AuthPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const router = useRouter();
  const [error, setError] = useState(
    screen.id === "U019"
      ? "入力内容をご確認ください。メールアドレスとパスワードが必要です。"
      : "",
  );
  const [avatar, setAvatar] = useState(state.profile.avatar);
  const go = (id: string) => router.push(screenPath(id) as Href);
  if (["U009", "U019"].includes(screen.id))
    return (
      <>
        <Panel title="マン組の仲間になろう">
          <Form
            submit="無料で会員登録"
            onSubmit={(v) => {
              if (v.name.trim().length < 2 || v.name.trim().length > 30) {
                setError("ニックネームは2〜30文字にしてください");
                return;
              }
              update((d) => {
                d.profile = {
                  ...d.profile,
                  name: v.name.trim(),
                  email: v.email.trim().toLowerCase(),
                  gender: v.gender,
                  avatar,
                  verified: false,
                  signedIn: false,
                  plan: "Free",
                };
              });
              go("U010");
            }}
          >
            <div className="upload-box">
              <img
                src={publicPath(avatar)}
                className="avatar-large"
                alt="プロフィール写真"
              />
              <label className="field">
                <span>プロフィール写真</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) {
                      setError("画像は5MB以下にしてください");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => setAvatar(String(reader.result));
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            </div>
            <Field
              name="name"
              label="ニックネーム"
              placeholder="マン組推し"
              required
              help="2〜30文字。あとから変更できます。"
            />
            <Select
              label="性別"
              name="gender"
              options={["回答しない", "男性", "女性", "その他"]}
            />
            <Field
              name="email"
              label="メールアドレス"
              type="email"
              required
              placeholder="you@example.com"
            />
            <Field
              name="password"
              label="パスワード"
              type="password"
              required
              help="12文字以上。プレビューではパスワードを保存しません。"
            />
            <label className="check-row">
              <input type="checkbox" required />
              <span>
                <RouteLink id="U003">利用規約</RouteLink>と
                <RouteLink id="U004">プライバシーポリシー</RouteLink>
                に同意します
              </span>
            </label>
            {error && <Notice tone="error">{error}</Notice>}
          </Form>
        </Panel>
        <Notice>
          UIプレビューではメールの実送信・本番アカウントの作成は行いません。
        </Notice>
        <Button id="U012" tone="ghost">
          ログインはこちら
        </Button>
      </>
    );
  if (screen.id === "U010")
    return (
      <>
        <Panel>
          <Empty
            icon="dm"
            title="メールを確認してね！"
            text={`${state.profile.email} 宛ての確認メール画面です。`}
          />
          <Notice>
            プレビューで確認フローをお試しください。メールは送信されません。
          </Notice>
          <Button
            className="full"
            tone="gold"
            onClick={() => {
              update((d) => {
                d.profile.verified = true;
                d.profile.signedIn = true;
              });
              go("U011");
            }}
          >
            確認リンクをプレビュー
          </Button>
          <Button
            className="full"
            tone="ghost"
            onClick={() => notify("確認メールのプレビューを更新しました")}
          >
            確認メールを再送
          </Button>
        </Panel>
        <Button id="U015" tone="ghost">
          メールアドレスを変更
        </Button>
      </>
    );
  if (screen.id === "U011")
    return (
      <>
        <Panel>
          <Empty
            icon="check"
            title="マン組へようこそ！"
            text="登録確認が完了しました。あなたの毎日に、最高のワクワクを。"
            action={
              <Button
                tone="gold"
                onClick={() => {
                  update((d) => {
                    d.profile.verified = true;
                    d.profile.signedIn = true;
                  });
                  go("U016");
                }}
              >
                プロフィールを確認
              </Button>
            }
          />
        </Panel>
      </>
    );
  if (screen.id === "U012")
    return (
      <>
        <Hero
          asset="hero_profile"
          label="WELCOME BACK"
          title="おかえり、マン組の仲間。"
        />
        <Panel title="ログイン">
          <Form
            submit="プレビューでログイン"
            onSubmit={(v) => {
              update((d) => {
                d.profile.email = v.email;
                d.profile.signedIn = true;
              });
              go(state.profile.verified ? "U022" : "U014");
            }}
          >
            <Field
              name="email"
              label="メールアドレス"
              type="email"
              value={state.profile.email}
              required
            />
            <Field
              name="password"
              label="パスワード"
              type="password"
              required
            />
            <Notice>本番認証に接続する前の操作プレビューです。</Notice>
          </Form>
          <div className="rule" />
          <RouteLink id="U013" className="back-link">
            パスワードを忘れた方
          </RouteLink>
        </Panel>
        <Button id="U009" tone="ghost">
          新しく会員登録する
        </Button>
      </>
    );
  if (screen.id === "U013")
    return (
      <Panel title="パスワードを再設定">
        <Form
          submit="再設定メールをプレビュー"
          onSubmit={() => {
            notify("パスワード再設定の受付画面を表示しました");
            setError(
              "入力されたメールへの送信は、本番の認証サーバー接続後に有効になります。",
            );
          }}
        >
          <Field
            name="email"
            label="登録済みメールアドレス"
            type="email"
            required
          />
          {error && <Notice>{error}</Notice>}
        </Form>
        <div className="rule" />
        <Button id="U012" tone="ghost">
          ログインに戻る
        </Button>
      </Panel>
    );
  if (screen.id === "U015")
    return (
      <Panel title="メールアドレスを変更">
        <Form
          submit="変更内容を確認"
          onSubmit={(v) => {
            update((d) => {
              d.profile.email = v.email;
              d.profile.verified = false;
            });
            go("U010");
          }}
        >
          <Field
            name="email"
            label="新しいメールアドレス"
            type="email"
            required
            value={state.profile.email}
          />
          <Notice>メール確認フローのプレビューに進みます。</Notice>
        </Form>
      </Panel>
    );
  if (screen.id === "U016")
    return (
      <>
        <Panel title="プロフィールをチェック">
          <div className="profile-summary">
            <img
              className="avatar-large"
              src={publicPath(state.profile.avatar)}
              alt="プロフィール写真"
            />
            <div>
              <h2>{state.profile.name}</h2>
              <p>{state.profile.email}</p>
              <Badge>Free MEMBER</Badge>
            </div>
          </div>
        </Panel>
        <Button id="U017" tone="gold">
          これでOK！次へ
        </Button>
        <Button id="U091" tone="ghost">
          プロフィールを編集
        </Button>
      </>
    );
  if (["U017", "U018"].includes(screen.id))
    return (
      <>
        <Panel>
          <Empty
            icon="bell"
            title={
              screen.id === "U018"
                ? "通知の設定を確認しよう"
                : "始まる瞬間を、逃さない。"
            }
            text="配信のお知らせやマン組からのメッセージを受け取れます。通知の種類はあとから変更できます。"
          />
          <Notice>
            iPhone /
            iPadではホーム画面に追加したアプリから通知を設定します。プレビューでは通知の配信は行いません。
          </Notice>
          <Button
            className="full"
            icon="bell"
            onClick={async () => {
              if (!("Notification" in window)) {
                notify("このブラウザは通知に対応していません");
                return;
              }
              const permission = await Notification.requestPermission();
              if (permission === "granted") {
                update((d) => {
                  d.settings.notifySchedule = true;
                });
                notify("通知を許可しました。配信接続は今後設定します");
                go("U022");
              } else go("U018");
            }}
          >
            通知をONにする
          </Button>
          <Button id="U001" tone="ghost" className="full">
            ホーム画面への追加方法
          </Button>
        </Panel>
        <Button id="U022" tone="ghost">
          あとで設定する
        </Button>
      </>
    );
  const states: Record<string, [string, string, string]> = {
    U014: [
      "メール確認が必要です",
      "確認リンクを開くと、配信予定やマン組のコンテンツを利用できます。",
      "U010",
    ],
    U020: [
      "このリンクは使えません",
      "有効期限が切れたか、すでに使用されています。新しい確認メールをご利用ください。",
      "U010",
    ],
    U021: [
      "アカウントの利用を停止しています",
      "停止理由や再開に関するご相談は、お問い合わせ窓口へご連絡ください。",
      "U101",
    ],
  };
  const [title, text, id] = states[screen.id];
  return (
    <Panel>
      <Empty
        icon="shield"
        title={title}
        text={text}
        action={
          <Button id={id} tone="gold">
            {id === "U101" ? "お問い合わせ" : "確認メールを確認する"}
          </Button>
        }
      />
    </Panel>
  );
}

export function SystemPage({ screen }: { screen: Screen }) {
  const { state, notify } = useStore();
  if (screen.id === "U109")
    return (
      <>
        <Panel>
          <Empty
            icon="mic"
            title="どの画面でも、マン組と。"
            text="参加中のスペースは画面を移動してもミニプレイヤーから戻れます。"
            action={
              <Button id={state.activeRoom ? "U042" : "U044"}>
                {state.activeRoom ? "参加中のスペースへ" : "スペースに参加"}
              </Button>
            }
          />
        </Panel>
      </>
    );
  const content: Record<string, [string, string, string, string]> = {
    U103: [
      "オフラインです",
      "接続を確認して、もう一度お試しください。オフライン中の送信は行いません。",
      "接続を確認する",
      "U022",
    ],
    U104: [
      "新しいバージョンがあります",
      "次のワクワクを受け取ろう。準備ができたら再読み込みしてください。",
      "再読み込み",
      "U022",
    ],
    U105: [
      "ただいまメンテナンス中",
      state.settings.maintenanceText,
      "お知らせを見る",
      "U023",
    ],
    U106: [
      "このコンテンツは限定公開です",
      "対象のプランと利用条件をご確認ください。",
      "プランを見る",
      "U089",
    ],
    U107: [
      "うまく接続できませんでした",
      "時間をおいてもう一度お試しください。送信内容はまだ確定していません。",
      "再試行する",
      "U022",
    ],
    U108: [
      "まだコンテンツがありません",
      "新しいお知らせや配信予定が追加されると、ここに表示されます。",
      "ホームへ",
      "U022",
    ],
  };
  const [title, text, label, id] = content[screen.id];
  return (
    <Panel>
      <Empty
        icon={screen.id === "U106" ? "shield" : "spark"}
        title={title}
        text={text}
        action={
          screen.id === "U104" ? (
            <Button onClick={() => window.location.reload()}>{label}</Button>
          ) : screen.id === "U103" ? (
            <Button
              onClick={() =>
                notify(
                  navigator.onLine
                    ? "オンラインに接続しています"
                    : "まだオフラインです",
                )
              }
            >
              {label}
            </Button>
          ) : (
            <Button id={id} tone="gold">
              {label}
            </Button>
          )
        }
      />
    </Panel>
  );
}
