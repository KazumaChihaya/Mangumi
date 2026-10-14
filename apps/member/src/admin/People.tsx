import React, { useState } from "react";
import { publicPath } from "../web-path";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import type { Screen } from "../registry";
import { screenPath } from "../registry";
import { useStore } from "../store";
import { yen } from "../model";
import {
  Badge,
  Button,
  Confirm,
  Empty,
  Field,
  Form,
  Icon,
  Notice,
  Panel,
  RouteLink,
  Row,
  Select,
  Table,
  Toggle,
  downloadCSV,
} from "../ui";
import { ConfigForm } from "./Common";
export function MembersPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("すべて");
  const router = useRouter();
  const member = state.members.find((m) => m.id === item) ?? state.members[0];
  const filtered = state.members.filter(
    (m) =>
      `${m.name} ${m.email}`.toLowerCase().includes(query.toLowerCase()) &&
      (plan === "すべて" || m.plan === plan),
  );
  if (screen.id === "A011")
    return (
      <>
        <div className="toolbar">
          <label className="search-box">
            <Icon name="search" />
            <input
              aria-label="会員を検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ニックネーム・メールアドレスで検索"
            />
          </label>
          <Select
            label="プラン"
            name="plan-filter"
            options={["すべて", ...state.plans.map((p) => p.name)]}
            value={plan}
            onChange={setPlan}
          />
          <Button
            tone="ghost"
            icon="download"
            onClick={() =>
              downloadCSV(
                "members.csv",
                ["ID", "表示名", "メール", "プラン", "状態"],
                filtered.map((m) => [m.id, m.name, m.email, m.plan, m.status]),
              )
            }
          >
            CSV出力
          </Button>
        </div>
        <Panel title={`会員一覧 / ${filtered.length}名`}>
          <Table
            columns={[
              "会員",
              "メールアドレス",
              "プラン",
              "状態",
              "登録日",
              "操作",
            ]}
            rows={filtered.map((m) => [
              <span className="space-between" key={m.id}>
                <img
                  src={publicPath("/assets/avatar.jpg")}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: "50%" }}
                />
                {m.name}
              </span>,
              m.email,
              <Badge key="plan">{m.plan}</Badge>,
              <Badge key="status" tone={m.status === "有効" ? "green" : "pink"}>
                {m.status}
              </Badge>,
              m.joined,
              <RouteLink
                key="link"
                id="A012"
                item={m.id}
                className="button ghost small"
              >
                詳細
              </RouteLink>,
            ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A012")
    return (
      <>
        <Panel title="会員プロフィール">
          <div className="profile-summary">
            <img
              className="avatar-large"
              src={publicPath("/assets/avatar.jpg")}
              alt={member.name}
            />
            <div>
              <h2>{member.name}</h2>
              <p>{member.email}</p>
              <Badge>{member.plan}</Badge>{" "}
              <Badge tone={member.status === "有効" ? "green" : "pink"}>
                {member.status}
              </Badge>
            </div>
          </div>
          <dl className="detail-grid">
            <dt>会員ID</dt>
            <dd>{member.id}</dd>
            <dt>登録日</dt>
            <dd>{member.joined}</dd>
            <dt>メール確認</dt>
            <dd>確認済み（サンプル）</dd>
          </dl>
          <div className="button-row">
            <RouteLink id="A013" item={member.id} className="button primary">
              プランを変更
            </RouteLink>
            <RouteLink id="A015" item={member.id} className="button ghost">
              利用停止・警告
            </RouteLink>
          </div>
        </Panel>
        <div className="two-columns">
          <Panel title="会員の権限">
            <Row title="個別の機能権限" id="A014" item={member.id} />
            <Row title="セッションを失効" id="A016" item={member.id} />
          </Panel>
          <Panel title="サポート対応">
            <Row title="開示・訂正・削除の対応" id="A017" item={member.id} />
            <Row title="監査履歴" id="A094" />
          </Panel>
        </div>
      </>
    );
  if (screen.id === "A013")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          { name: "member", label: "会員", value: member.name },
          {
            name: "plan",
            label: "変更先プラン",
            value: member.plan,
            options: state.plans.map((p) => p.name),
          },
          { name: "apply", label: "適用時期", options: ["即時", "予約"] },
          { name: "date", label: "予約日時", type: "datetime-local" },
          { name: "reason", label: "変更理由", required: true },
        ]}
        onSave={(v) => {
          if (v.apply === "即時")
            update(
              (d) => {
                d.members.find((m) => m.id === member.id)!.plan = v.plan;
              },
              "会員プラン変更",
              member.name,
              v.reason,
            );
          else notify("予約内容を記録しました。本番ジョブで適用する設定です");
        }}
        notice="予約の実行は本番API接続後に行います。即時変更はこのプレビューに反映されます。"
      />
    );
  if (screen.id === "A014")
    return (
      <Panel title={`${member.name}の個別権限`}>
        <Notice>
          例外権限は設定の変更履歴に記録します。本番はAPIでも同じ権限判定を行います。
        </Notice>
        {[
          "calendar.view",
          "notification.receive",
          "story.view",
          "dm.send",
          "dm.audio.send",
          "voice.join",
          "voice.speak",
          "voice.create",
          "tip.send",
          "gacha.draw",
        ].map((feature) => (
          <Toggle
            key={feature}
            label={feature}
            checked={
              state.records[`override-${member.id}`]?.[feature] === "true"
            }
            onChange={(checked) =>
              update(
                (d) => {
                  d.records[`override-${member.id}`] = {
                    ...d.records[`override-${member.id}`],
                    [feature]: String(checked),
                  };
                },
                "機能権限の上書き",
                member.name,
              )
            }
          />
        ))}
      </Panel>
    );
  if (screen.id === "A015")
    return (
      <Panel className="confirmation">
        <Empty
          icon="shield"
          title={`${member.name}への措置`}
          text="利用者への影響を確認し、理由を記録してから確定してください。"
        />
        <Form
          submit="措置を確定"
          tone="danger"
          onSubmit={(v) => {
            update(
              (d) => {
                d.members.find((m) => m.id === member.id)!.status = v.action;
              },
              "会員への措置",
              member.name,
              v.reason,
            );
            notify("措置を記録しました");
            router.push((screenPath("A012") + `?item=${member.id}`) as Href);
          }}
        >
          <Select
            label="措置"
            name="action"
            options={["警告", "一時停止", "永久停止", "有効"]}
          />
          <Field label="停止期限" name="until" type="datetime-local" />
          <Field label="理由" name="reason" multiline required />
          <label className="check-row">
            <input type="checkbox" required />
            対象会員と措置を確認しました
          </label>
        </Form>
      </Panel>
    );
  if (screen.id === "A016")
    return (
      <Confirm
        title={`${member.name}のセッションを失効`}
        text="選択した会員のログイン中端末を終了する操作のプレビューです。"
        action="セッションを失効"
        reason
        back="A011"
        onConfirm={(reason) => {
          update(
            (d) => {
              d.records[`session-${member.id}`] = { status: "失効", reason };
            },
            "会員セッション失効",
            member.name,
            reason,
          );
          notify("セッション失効を記録しました");
        }}
      />
    );
  return (
    <ConfigForm
      screen={screen}
      fields={[
        { name: "member", label: "対象会員", value: member.name },
        {
          name: "request",
          label: "依頼内容",
          options: ["データ開示", "情報訂正", "データ削除", "退会対応"],
        },
        {
          name: "verification",
          label: "本人確認",
          options: ["未確認", "確認済み"],
        },
        {
          name: "status",
          label: "対応状態",
          options: ["受付", "調査中", "対応完了"],
        },
        { name: "reason", label: "対応記録", multiline: true, required: true },
      ]}
      notice="正式な本人確認・データの削除は本番の運用フローで行います。"
    />
  );
}
export function PlansPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const [error, setError] = useState("");
  if (screen.id === "A018")
    return (
      <>
        <div className="toolbar">
          <Notice>初期公開はFreeのみ。有料プランは準備中です。</Notice>
          <Button id="A019" icon="plus">
            プランを作成
          </Button>
        </div>
        <div className="plan-grid">
          {state.plans.map((p) => (
            <div
              className={`plan-card ${p.name === "LEGEND" ? "featured" : ""}`}
              key={p.id}
            >
              <div className="space-between">
                <h2>{p.name}</h2>
                <Badge tone={p.published ? "green" : "gray"}>
                  {p.published ? "公開" : "非公開"}
                </Badge>
              </div>
              <p className="price">
                {yen(p.price)}
                <small> / 月（サンプル）</small>
              </p>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="preview-note">
                加入者 {state.members.filter((m) => m.plan === p.name).length}名
              </p>
              <RouteLink id="A022" item={p.id} className="button ghost full">
                料金・公開を編集
              </RouteLink>
            </div>
          ))}
        </div>
      </>
    );
  if (screen.id === "A019")
    return (
      <Panel title="新しいプラン">
        <Form
          onSubmit={(v) => {
            if (
              state.plans.some(
                (p) => p.name.toLowerCase() === v.name.toLowerCase(),
              )
            ) {
              setError("同じ名前のプランが存在します");
              return;
            }
            update(
              (d) => {
                d.plans.push({
                  id: crypto.randomUUID(),
                  name: v.name,
                  price: Number(v.price),
                  features: v.features.split("\n").filter(Boolean),
                  published: false,
                });
              },
              "プラン作成",
              v.name,
            );
            notify("非公開プランを作成しました");
          }}
        >
          <div className="field-grid">
            <Field name="name" label="プラン名" required />
            <Field
              name="price"
              label="月額（円）"
              type="number"
              min={0}
              value={0}
              required
            />
            <Field name="description" label="プラン説明" multiline />
            <Field
              name="features"
              label="特典（1行に1項目）"
              multiline
              required
            />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <Notice>
            新規プランは非公開で作成します。Freeプランは削除できません。
          </Notice>
        </Form>
      </Panel>
    );
  if (screen.id === "A020") {
    const features = [
      "calendar.view",
      "notification.receive",
      "story.view",
      "dm.send",
      "voice.join",
      "voice.speak",
      "voice.create",
      "tip.send",
      "gacha.draw",
    ];
    return (
      <Panel title="機能権限マトリクス">
        <div className="table-scroll role-matrix">
          <table>
            <thead>
              <tr>
                <th>機能キー</th>
                {state.plans.map((p) => (
                  <th key={p.id}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f}>
                  <td>{f}</td>
                  {state.plans.map((p) => (
                    <td key={p.id}>
                      <input
                        type="checkbox"
                        aria-label={`${p.name} ${f}`}
                        checked={
                          state.records[`entitlement-${p.id}`]?.[f] ===
                            "true" ||
                          (state.records[`entitlement-${p.id}`]?.[f] ===
                            undefined &&
                            ["calendar.view", "notification.receive"].includes(
                              f,
                            ))
                        }
                        onChange={(e) =>
                          update(
                            (d) => {
                              d.records[`entitlement-${p.id}`] = {
                                ...d.records[`entitlement-${p.id}`],
                                [f]: String(e.target.checked),
                              };
                            },
                            "プラン機能割当変更",
                            `${p.name}:${f}`,
                          )
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notice>
          機能キーは登録済みの項目のみ設定可能です。API側の権限チェックは本番の実装で接続します。
        </Notice>
      </Panel>
    );
  }
  if (screen.id === "A021")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "audio",
            label: "音声メッセージ上限（秒）",
            type: "number",
            value: state.settings.audioSeconds,
            min: 1,
            max: 300,
          },
          {
            name: "retention",
            label: "保存期間（日）",
            type: "number",
            value: state.settings.retention,
            min: 1,
          },
          {
            name: "room",
            label: "ルーム参加上限（人）",
            type: "number",
            value: state.settings.roomLimit,
            min: 1,
          },
          {
            name: "daily",
            label: "DM送信上限／日",
            type: "number",
            value: 100,
            min: 1,
          },
        ]}
        onSave={(v) =>
          update((d) => {
            d.settings.audioSeconds = Number(v.audio);
            d.settings.retention = Number(v.retention);
            d.settings.roomLimit = Number(v.room);
          }, "利用上限変更")
        }
      />
    );
  if (screen.id === "A022")
    return (
      <Panel title="プランの料金・公開状態">
        {state.plans.map((p) => (
          <Panel key={p.id} title={p.name}>
            <Form
              onSubmit={(v) => {
                update(
                  (d) => {
                    const plan = d.plans.find((x) => x.id === p.id)!;
                    plan.price = p.name === "Free" ? 0 : Number(v.price);
                    plan.published =
                      p.name === "Free" || v.published === "公開";
                  },
                  "プラン料金・公開変更",
                  p.name,
                );
                notify(`${p.name}を更新しました`);
              }}
            >
              <div className="field-grid">
                <Field
                  name="price"
                  label="月額料金（円）"
                  type="number"
                  min={0}
                  value={p.price}
                  required
                />
                <Select
                  name="published"
                  label="公開状態"
                  options={["非公開", "公開"]}
                  value={p.published ? "公開" : "非公開"}
                />
                <Field
                  name="trial"
                  label="無料体験（日）"
                  type="number"
                  min={0}
                  value={0}
                />
                <Field
                  name="until"
                  label="申込受付終了"
                  type="datetime-local"
                />
              </div>
            </Form>
          </Panel>
        ))}
        <Notice>
          Freeは無料・公開の状態を保持します。決済画面の有効化は別途行います。
        </Notice>
      </Panel>
    );
  if (screen.id === "A023")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "plan",
            label: "対象プラン",
            options: state.plans.map((p) => p.name),
          },
          {
            name: "at",
            label: "適用日時",
            type: "datetime-local",
            required: true,
          },
          { name: "reason", label: "変更理由", required: true },
          { name: "notice", label: "会員へのお知らせ", multiline: true },
        ]}
        notice="影響を受ける会員数を確認してから適用します。予約の実行は本番ジョブ接続後に有効になります。"
      >
        <Row
          title="対象候補の会員"
          sub={`${state.members.length}名の会員を管理中`}
          end={<Badge>影響確認</Badge>}
        />
      </ConfigForm>
    );
  return (
    <Panel title="個別権限の変更履歴">
      <Table
        columns={["操作", "対象", "理由", "日時"]}
        rows={state.audit
          .filter((a) => /権限|プラン/.test(a.action))
          .map((a) => [
            a.action,
            a.target,
            a.reason,
            new Date(a.at).toLocaleString("ja-JP"),
          ])}
        empty="権限の変更履歴はありません"
      />
    </Panel>
  );
}
