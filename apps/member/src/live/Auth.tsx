import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { api, session, upload } from "../api";
import { useStore } from "../store";
import { screenPath, type Screen } from "../registry";
import {
  Button,
  Empty,
  Field,
  Form,
  Notice,
  Panel,
  RouteLink,
  Select,
} from "../ui";
import { nativeHost,nativeCall } from "../native-bridge";

export async function enablePush() {
  if (nativeHost()) { await nativeCall("push.enable"); return; }
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !standalone)
    throw new Error(
      "先に共有メニューからホーム画面へ追加し、アプリを開いてください",
    );
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    throw new Error("このブラウザは通知に対応していません");
  const config = await api("/config");
  if (!config.vapidPublic) throw new Error("運営側の通知配信設定が必要です");
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("ブラウザの設定から通知を許可してください");
  const registration = await navigator.serviceWorker.ready;
  const raw = atob(config.vapidPublic.replace(/-/g, "+").replace(/_/g, "/"));
  const applicationServerKey = Uint8Array.from(raw, (char) =>
    char.charCodeAt(0),
  );
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));
  await api("/push-subscriptions", subscription.toJSON());
}
export function LiveAuth({ screen }: { screen: Screen }) {
  const { state, refresh, update, notify } = useStore();
  const router = useRouter();
  const query = useLocalSearchParams<{ token?: string }>();
  const [email, setEmail] = useState("");
  const [avatar, setAvatar] = useState("");
  const [mfa, setMfa] = useState<{
    secret?: string;
    uri?: string;
    required?: boolean;
  }>({});
  const [recovery, setRecovery] = useState<string[]>([]);
  const go = (id: string) => router.push(screenPath(id) as Href);
  const admin = screen.area === "admin";
  useEffect(() => {
    if (screen.id === "A002")
      void session("admin")
        .then((result) => setMfa({ required: result.enrollmentRequired }))
        .catch((error) => notify(error.message));
  }, [screen.id]);
  if (["U009", "U019"].includes(screen.id))
    return (
      <Panel title="マン組の仲間になろう">
        <Form
          submit="無料で会員登録"
          onSubmit={async (values) => {
            if (!avatar)
              throw new Error("プロフィール写真をアップロードしてください");
            const config = await api("/config");
            await api("/auth/register", {
              name: values.name,
              email: values.email,
              password: values.password,
              gender: values.gender,
              avatar,
              termsVersion: config.termsVersion,
            });
            sessionStorage.setItem("mangumi-registration-email", values.email);
            go("U010");
          }}
        >
          <label className="field">
            <span>プロフィール写真（必須）</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setAvatar((await upload(file, "avatar")).url);
                } catch (error) {
                  notify((error as Error).message);
                }
              }}
            />
          </label>
          {avatar && (
            <img src={avatar} className="avatar-large" alt="プロフィール写真" />
          )}
          <Field name="name" label="ニックネーム" required />
          <Select
            name="gender"
            label="性別"
            options={["回答しない", "男性", "女性", "その他"]}
          />
          <Field name="email" label="メールアドレス" type="email" required />
          <Field
            name="password"
            label="パスワード"
            type="password"
            required
            help="12文字以上で設定してください"
          />
          <label className="check-row">
            <input type="checkbox" required />
            <span>
              <RouteLink id="U003">利用規約</RouteLink>と
              <RouteLink id="U004">プライバシーポリシー</RouteLink>に同意します
            </span>
          </label>
        </Form>
        <Button id="U012" tone="ghost">
          ログインはこちら
        </Button>
      </Panel>
    );
  if (["U012", "A001"].includes(screen.id))
    return (
      <Panel title={admin ? "管理者ログイン" : "ログイン"}>
        <Form
          submit="ログイン"
          onSubmit={async (values) => {
            const result = await api(
              admin ? "/admin/auth/login" : "/auth/login",
              { email: values.email, password: values.password },
              "POST",
              admin ? "admin" : "member",
            );
            await refresh();
            go(
              admin
                ? "A002"
                : result.verified
                  ? result.onboardingRequired
                    ? "U016"
                    : "U022"
                  : "U014",
            );
          }}
        >
          <Field name="email" label="メールアドレス" type="email" required />
          <Field name="password" label="パスワード" type="password" required />
        </Form>
        <RouteLink id={admin ? "A003" : "U013"}>パスワードを忘れた方</RouteLink>
        {!admin && (
          <Button id="U009" tone="ghost">
            新しく会員登録する
          </Button>
        )}
      </Panel>
    );
  if (screen.id === "A002")
    return (
      <Panel title="二要素認証">
        {mfa.required && !mfa.secret && (
          <Button
            onClick={async () => {
              const result = await api(
                "/admin/auth/mfa/enroll",
                {},
                "POST",
                "admin",
              );
              setMfa({ ...result, required: true });
            }}
          >
            認証アプリへ登録する
          </Button>
        )}
        {mfa.secret && (
          <Notice>
            <p>認証アプリへこのキーを登録してください。</p>
            <code style={{ overflowWrap: "anywhere" }}>{mfa.secret}</code>
          </Notice>
        )}
        {recovery.length ? (
          <>
            <Notice>
              <p>
                復旧コードを安全な場所に保存してください。各コードは一度だけ使えます。
              </p>
              {recovery.map((code) => (
                <div key={code}>
                  <code>{code}</code>
                </div>
              ))}
            </Notice>
            <Button id="A008">保存したので管理画面へ</Button>
          </>
        ) : (
          <Form
            submit="認証する"
            onSubmit={async (values) => {
              const result = await api(
                "/admin/auth/mfa/verify",
                { code: values.code },
                "POST",
                "admin",
              );
              await refresh();
              if (result.recoveryCodes) setRecovery(result.recoveryCodes);
              else go("A008");
            }}
          >
            <Field name="code" label="認証コード・復旧コード" required />
          </Form>
        )}
      </Panel>
    );
  if (["U013", "A003"].includes(screen.id))
    return (
      <Panel title="パスワードを再設定">
        {query.token ? (
          <Form
            submit="パスワードを変更"
            onSubmit={async (values) => {
              await api("/auth/password/reset", {
                token: query.token,
                password: values.password,
              });
              notify("変更しました。もう一度ログインしてください");
              go(admin ? "A001" : "U012");
            }}
          >
            <Field
              name="password"
              label="新しいパスワード"
              type="password"
              required
              help="12文字以上"
            />
          </Form>
        ) : (
          <Form
            submit="再設定メールを送信"
            onSubmit={async (values) => {
              await api("/auth/password/request", { email: values.email });
              notify("登録がある場合は再設定メールを送ります");
            }}
          >
            <Field
              name="email"
              label="登録済みメールアドレス"
              type="email"
              required
            />
          </Form>
        )}
      </Panel>
    );
  if (["U010", "U014"].includes(screen.id))
    return (
      <Panel title="メールアドレスを確認してください">
        <p>確認メールのリンクを開くと利用できます。</p>
        <Form
          submit="確認メールを再送"
          onSubmit={async (values) => {
            await api("/auth/resend", { email: values.email });
            notify("再送を受け付けました");
          }}
        >
          <Field
            name="email"
            label="登録したメールアドレス"
            type="email"
            value={state.profile.email || email}
            required
          />
        </Form>
        <Button id="U012" tone="ghost">
          ログイン画面へ
        </Button>
      </Panel>
    );
  if (screen.id === "U011")
    return (
      <Panel title="メールアドレスを確認">
        <p>確認ボタンを押して登録を完了してください。</p>
        <Form
          submit="メールアドレスを確認する"
          onSubmit={async () => {
            if (!query.token)
              throw new Error("確認メールのリンクから開いてください");
            await api("/auth/verify", { token: query.token });
            await refresh();
            notify("メール確認が完了しました");
            go("U012");
          }}
        />
      </Panel>
    );
  if (screen.id === "U015")
    return (
      <Panel title="メールアドレスを変更">
        <Form
          submit="新しいアドレスへ確認メールを送信"
          onSubmit={async (values) => {
            await api("/me/email", {
              email: values.email,
              password: values.password,
            });
            notify("新しいアドレスに確認メールを送ります");
          }}
        >
          <Field
            name="email"
            label="新しいメールアドレス"
            type="email"
            required
          />
          <Field
            name="password"
            label="現在のパスワード"
            type="password"
            required
          />
          <Notice>
            新しいアドレスの確認が完了するまでは、現在のアドレスでログインできます。
          </Notice>
        </Form>
      </Panel>
    );
  if (screen.id === "U016")
    return (
      <Panel title="プロフィールを確認">
        <p>{state.profile.name}</p>
        <Button id="U017">通知の設定へ</Button>
        <Button id="U091" tone="ghost">
          プロフィールを編集
        </Button>
      </Panel>
    );
  if (["U017", "U018"].includes(screen.id))
    return (
      <Panel title="マン組の更新を通知で受け取る">
        <p>
          配信予定や新着メッセージをお知らせします。通知の種類は後から変更できます。
        </p>
        <Button
          onClick={async () => {
            await enablePush();
            await api("/me/onboarding", {});
            await refresh();
            notify("通知を登録しました");
            go("U022");
          }}
        >
          通知をONにする
        </Button>
        <Button
          tone="ghost"
          onClick={async () => {
            await api("/me/onboarding", {});
            await refresh();
            go("U022");
          }}
        >
          あとで設定する
        </Button>
        {screen.id === "U018" && (
          <Notice>
            OSとブラウザの設定から、このアプリの通知を許可してください。
          </Notice>
        )}
      </Panel>
    );
  if (screen.id === "A004")
    return (
      <Panel title="管理者プロフィール">
        <p>{state.profile.name}</p>
        <Button
          onClick={async () => {
            await api("/admin/auth/logout", {}, "POST", "admin");
            await refresh();
            go("A001");
          }}
        >
          ログアウト
        </Button>
      </Panel>
    );
  return (
    <Panel>
      <Empty
        icon="shield"
        title={
          screen.id === "U021"
            ? "現在このアカウントは利用できません"
            : screen.id === "A005"
              ? "この操作を行う権限がありません"
              : "もう一度ログインしてください"
        }
        text="登録情報と権限を確認してください。"
        action={<Button id={admin ? "A001" : "U012"}>ログイン画面へ</Button>}
      />
    </Panel>
  );
}
