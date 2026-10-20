import React, { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Screen } from "../registry";
import {
  Button,
  Empty,
  Field,
  Form,
  Notice,
  Panel,
  Row,
  Select,
  Table,
  Toggle,
} from "../ui";
import { yen } from "../model";
import { useResource } from "./hooks";
import { enablePush } from "./Auth";
import { saveJson } from "./Members";
import { request } from "../generated/api-client";
import { nativeHost } from "../native-bridge";
import { NativeStoreAccount } from "./Native";

export function LiveAccount({ screen }: { screen: Screen }) {
  const { state, refresh, notify, update } = useStore();
  const billing = useResource("/billing/status");
  const blocks = useResource<any[]>(
    screen.id === "U097" ? "/blocks" : undefined,
  );
  const sessions = useResource<any[]>(
    screen.id === "U098" ? "/me/sessions" : undefined,
  );
  const devices = useResource<any[]>(
    screen.id === "U090" ? "/push-subscriptions" : undefined,
  );
  const checkout = async (body: any) => {
    const result = await api(
      "/billing/checkout",
      body,
      "POST",
      "member",
      crypto.randomUUID(),
    );
    window.location.assign(result.url);
  };
  if (screen.id === "U090")
    return (
      <>
        <Panel title="通知を設定">
          <p>
            配信予定やメッセージを通知します。通知をONにするボタンを押すと、端末の許可を確認します。
          </p>
          <Button
            onClick={async () => {
              await enablePush();
              await devices.reload();
              notify("この端末の通知を登録しました");
            }}
          >
            通知をONにする
          </Button>
          {devices.error && <Notice>{devices.error}</Notice>}
          {[
            ["notifySchedule", "配信予定"],
            ["notifyStory", "ストーリー"],
            ["notifyDM", "メッセージ"],
            ["notifyVoice", "音声ルーム"],
            ["notifyGacha", "ガチャ"],
            ["notifyGeneral", "運営のお知らせ"],
            ["notifySecurity", "セキュリティのお知らせ"],
          ].map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              checked={(state.settings as any)[key] !== false}
              onChange={(value) =>
                update((draft) => {
                  (draft.settings as any)[key] = value;
                })
              }
            />
          ))}
          <Form
            submit="サイレント時間帯を保存"
            onSubmit={async (values) => {
              await update((draft) => {
                draft.settings.quiet = values.quiet === "利用する";
                draft.settings.quietFrom = values.from;
                draft.settings.quietTo = values.to;
              });
              notify("通知の時間帯を保存しました");
            }}
          >
            <label className="field">
              <span>サイレント時間帯</span>
              <select
                name="quiet"
                defaultValue={state.settings.quiet ? "利用する" : "利用しない"}
              >
                <option>利用する</option>
                <option>利用しない</option>
              </select>
            </label>
            <Field
              name="from"
              label="開始時刻（日本時間）"
              type="time"
              value={state.settings.quietFrom}
              required
            />
            <Field
              name="to"
              label="終了時刻（日本時間）"
              type="time"
              value={state.settings.quietTo}
              required
            />
          </Form>
          <Button id="U017" tone="ghost">
            通知の許可・ホーム画面への追加について
          </Button>
        </Panel>
        <Panel title="通知を受け取る端末">
          {devices.data?.map((device) => (
            <Row
              key={device.id}
              title={device.agent || "登録済みの端末"}
              sub={`登録日 ${new Date(device.at).toLocaleString("ja-JP")}`}
              end={
                <Button
                  tone="danger"
                  onClick={async () => {
                    await api(
                      `/push-subscriptions/${device.id}`,
                      undefined,
                      "DELETE",
                    );
                    await devices.reload();
                  }}
                >
                  この端末への配信を停止
                </Button>
              }
            />
          ))}
          {!devices.data?.length && <p>通知端末はまだ登録されていません。</p>}
        </Panel>
      </>
    );
  if (["U089", "U094", "U095", "U096"].includes(screen.id))
    return (
      <>
        {state.plans.map((plan) => (
          <Panel
            key={plan.id}
            title={
              nativeHost() ? plan.name : `${plan.name} · ${yen(plan.price)}/月`
            }
          >
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {(plan as any).description && <p>{(plan as any).description}</p>}
            {plan.price > 0 && (
              <Button
                onClick={() => checkout({ kind: "plan", planId: plan.id })}
              >
                このプランに申し込む
              </Button>
            )}
            {(plan as any).yearPrice > 0 && (
              <Button
                onClick={() =>
                  checkout({ kind: "plan", planId: plan.id, period: "year" })
                }
              >
                {nativeHost()
                  ? "年額プランのストア価格を確認"
                  : `年額 ${yen((plan as any).yearPrice)}で申し込む`}
              </Button>
            )}
          </Panel>
        ))}
        <NativeStoreAccount />
        {!nativeHost() &&
          billing.data?.storeSubscription?.status === "active" && (
            <Notice>
              このプランはアプリストアで契約されています。更新や解約はApp
              Store／Google Playの契約管理で行ってください。
            </Notice>
          )}
        {!nativeHost() && billing.data?.subscription && (
          <Panel title="契約管理">
            <p>{billing.data.subscription.status}</p>
            <p>
              解約方針：
              {(
                state.plans.find(
                  (p) => p.id === billing.data.subscription.planId,
                ) as any
              )?.cancellation === "immediate"
                ? "解約時に終了"
                : "支払済み期間の終了まで利用可能"}
            </p>
            {!billing.data.subscription.cancelAtPeriodEnd && (
              <Form
                submit="契約の解約を申し込む"
                tone="danger"
                onSubmit={async () => {
                  await api(
                    "/billing/cancel",
                    { confirmed: true },
                    "POST",
                    "member",
                    crypto.randomUUID(),
                  );
                  notify(
                    "解約を受け付けました。契約状況の更新をお待ちください",
                  );
                  await billing.reload();
                }}
              >
                <label className="check-row">
                  <input type="checkbox" required />
                  解約方針を確認し、解約を申し込みます
                </label>
              </Form>
            )}
            {billing.data.subscription.cancelAtPeriodEnd && (
              <Notice>次回更新時の解約を受け付けています。</Notice>
            )}
            <Button
              onClick={async () => {
                const result = await api("/billing/portal", {});
                window.location.assign(result.url);
              }}
            >
              プラン変更・解約・請求書
            </Button>
          </Panel>
        )}
      </>
    );
  if (screen.id === "U097")
    return (
      <Panel title="ブロック一覧">
        {blocks.error && <Notice>{blocks.error}</Notice>}
        {blocks.data?.map((block) => (
          <Row
            key={block.id}
            title={block.name ?? block.userId}
            end={
              <Button
                onClick={async () => {
                  await api(`/blocks/${block.userId}`, undefined, "DELETE");
                  await blocks.reload();
                }}
              >
                解除
              </Button>
            }
          />
        ))}
        {!blocks.data?.length && (
          <Empty
            title="ブロック中の相手はいません"
            text="ここから解除できます。"
          />
        )}
      </Panel>
    );
  if (screen.id === "U098")
    return (
      <Panel title="ログイン中の端末">
        {sessions.data?.map((session) => (
          <Row
            key={session.id}
            title={session.agent}
            sub={
              session.current
                ? "現在の端末"
                : `最終利用 ${new Date(session.touched_at).toLocaleString("ja-JP")}`
            }
            end={
              <Button
                tone="ghost"
                onClick={async () => {
                  await api(`/me/sessions/${session.id}`, undefined, "DELETE");
                  await sessions.reload();
                  await refresh();
                }}
              >
                ログアウト
              </Button>
            }
          />
        ))}
        <Button id="U099" tone="danger">
          全端末からログアウト
        </Button>
      </Panel>
    );
  if (screen.id === "U099")
    return (
      <Panel title="ログアウトしますか？">
        <Button
          onClick={async () => {
            await api("/auth/logout", {});
            await refresh();
          }}
        >
          この端末からログアウト
        </Button>
        <Button
          tone="danger"
          onClick={async () => {
            await api("/me/sessions/all", undefined, "DELETE");
            await refresh();
          }}
        >
          すべての端末からログアウト
        </Button>
      </Panel>
    );
  if (screen.id === "U100")
    return (
      <Panel title="ご利用履歴">
        {billing.error && <Notice>{billing.error}</Notice>}
        <Table
          columns={["日時", "内容", "金額", "状態"]}
          rows={(billing.data?.tips ?? []).map((tip: any) => [
            new Date(tip.at).toLocaleString("ja-JP"),
            "マン組への応援",
            ["ios", "android", "native-coins"].includes(tip.provider)
              ? `${tip.amount}コイン`
              : yen(tip.amount),
            tip.status,
          ])}
        />
        <Table
          columns={["抽選日", "景品", "確率版"]}
          rows={state.draws.map((draw) => [
            new Date(draw.at).toLocaleString("ja-JP"),
            draw.title,
            draw.version,
          ])}
        />
      </Panel>
    );
  if (screen.id === "U101")
    return (
      <Panel title="お問い合わせ">
        <Form
          submit="問い合わせを送信"
          onSubmit={async (values) => {
            const entry = {
              id: crypto.randomUUID(),
              subject: values.subject,
              body: values.body,
              status: "未対応",
            };
            await api(
              "/commands",
              {
                changes: [{ resource: "support", id: entry.id, after: entry }],
                action: "問い合わせ送信",
                reason: "利用者からの問い合わせ",
              },
              "POST",
              "member",
              crypto.randomUUID(),
            );
            await refresh();
            notify("問い合わせを受け付けました");
          }}
        >
          <Field name="subject" label="件名" required />
          <Field name="body" label="お問い合わせ内容" multiline required />
        </Form>
        {state.support.map((item) => (
          <Panel key={item.id} title={item.subject}>
            <p>{item.body}</p>
            <small>{item.status}</small>
            {(item as any).reply && (
              <blockquote>
                <p>{(item as any).reply}</p>
                <small>
                  {new Date((item as any).repliedAt).toLocaleString("ja-JP")}
                </small>
              </blockquote>
            )}
          </Panel>
        ))}
        <Button
          tone="ghost"
          onClick={async () =>
            saveJson(await api("/me/export"), "mangumi-account.json")
          }
        >
          自分のデータをダウンロード
        </Button>
      </Panel>
    );
  return (
    <Panel title="退会する">
      <Notice>
        退会するとログインできなくなります。法令や通報対応に必要な履歴は、プライバシーポリシーに従って保持します。
      </Notice>
      <Form
        submit="退会を確定"
        tone="danger"
        onSubmit={async (values) => {
          await api("/me/close", { password: values.password });
          await refresh();
          notify("退会手続きが完了しました");
        }}
      >
        <Field
          name="password"
          label="現在のパスワード"
          type="password"
          required
        />
        <label className="check-row">
          <input type="checkbox" required />
          退会の内容を確認しました
        </label>
      </Form>
    </Panel>
  );
}
export function LivePayments({ screen }: { screen: Screen }) {
  const { state } = useStore();
  const [amount, setAmount] = useState("");
  const officials = useResource<any[]>("/officials", 0);
  const billing = useResource("/billing/status");
  const config = useResource("/config", 0);
  const messages = useResource<any[]>("/tips/messages");
  return (
    <>
      {config.data?.billingEnabled &&
      state.entitlements?.["tip.send"] !== false ? (
        <Panel title="マン組を応援する">
          <Form
            submit="お支払いへ進む"
            onSubmit={async (values) => {
              const result = await request("post_api_billing_checkout", {
                params: {},
                body: {
                  kind: "tip",
                  amount: Number(values.amount),
                  recipient: values.recipient,
                  message: values.message,
                  visibility:
                    values.visibility === "ニックネームとメッセージを公開"
                      ? "public"
                      : "private",
                },
                area: "member",
                key: crypto.randomUUID(),
              });
              window.location.assign(result.url);
            }}
          >
            <label className="field">
              <span>応援するメンバー</span>
              <select name="recipient" required>
                {officials.data?.map((official) => (
                  <option key={official.id} value={official.id}>
                    {official.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              {((state.settings as any).tipPresets ?? [500, 1000, 3000])
                .filter(
                  (n: number) =>
                    n <= state.settings.tipMax &&
                    n >= ((state.settings as any).tipMin ?? 100),
                )
                .map((n: number) => (
                  <Button
                    key={n}
                    tone="ghost"
                    onClick={() => setAmount(String(n))}
                  >
                    {nativeHost() ? `${n}コイン` : yen(n)}
                  </Button>
                ))}
            </div>
            <label className="field">
              <span>
                {nativeHost() ? "使用する応援コイン" : "応援金額（円）"}
              </span>
              <input
                name="amount"
                type="number"
                min={(state.settings as any).tipMin ?? 100}
                max={state.settings.tipMax}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <Field name="message" label="応援メッセージ" multiline />
            <Select
              name="visibility"
              label="メッセージの公開範囲"
              options={["受取人と運営のみ", "ニックネームとメッセージを公開"]}
              value="受取人と運営のみ"
            />
            {nativeHost() && (
              <Notice>
                コインが不足する場合は、ストアの価格を確認して購入します。コインをガチャやプラン権限へ利用することはできません。
              </Notice>
            )}
            <Notice>
              お支払い後、結果の反映までしばらくかかることがあります。
            </Notice>
          </Form>
        </Panel>
      ) : (
        <Panel>
          <Empty
            title={
              config.data?.billingEnabled
                ? "応援機能の利用には対応プランが必要です"
                : "応援機能は準備中です"
            }
            text={
              config.data?.billingEnabled
                ? "マイページから利用できるプランをご確認ください。"
                : "受付開始のお知らせをお待ちください。"
            }
          />
        </Panel>
      )}
      {nativeHost() ? (
        <NativeStoreAccount />
      ) : (
        <Panel title="お支払い方法">
          {billing.data?.paymentMethod && (
            <p>
              {billing.data.paymentMethod.brand} ····{" "}
              {billing.data.paymentMethod.last4}
            </p>
          )}
          <Button
            onClick={async () => {
              const result = await api(
                "/billing/checkout",
                { kind: "setup" },
                "POST",
                "member",
                crypto.randomUUID(),
              );
              window.location.assign(result.url);
            }}
          >
            カードを登録する
          </Button>
          {billing.error && <Notice>{billing.error}</Notice>}
        </Panel>
      )}
      <Panel title="応援履歴">
        <Table
          columns={["日時", "金額", "状態"]}
          rows={(billing.data?.tips ?? []).map((tip: any) => [
            new Date(tip.at).toLocaleString("ja-JP"),
            ["ios", "android", "native-coins"].includes(tip.provider)
              ? `${tip.amount}コイン`
              : yen(tip.amount),
            tip.status,
          ])}
        />
      </Panel>
      <Panel title="応援メッセージ">
        {messages.error && <Notice>{messages.error}</Notice>}
        {!messages.data?.length && (
          <p>公開された応援メッセージはまだありません。</p>
        )}
        {messages.data?.map((item) => (
          <Row
            key={item.id}
            title={`${item.name}さん${item.own && item.visibility !== "public" ? "（自分宛て・非公開）" : ""}`}
            sub={item.message || "応援ありがとうございます！"}
            end={<small>{new Date(item.at).toLocaleDateString("ja-JP")}</small>}
          />
        ))}
      </Panel>
    </>
  );
}
