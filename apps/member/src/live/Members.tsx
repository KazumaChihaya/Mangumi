import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { api } from "../api";
import { useStore } from "../store";
import { features } from "../features";
import type { Screen } from "../registry";
import {
  Badge,
  Button,
  Empty,
  Field,
  Form,
  Notice,
  Panel,
  RouteLink,
  Select,
  Table,
} from "../ui";
import { useResource } from "./hooks";
export function saveJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function LiveMembers({ screen }: { screen: Screen }) {
  const { state, role, refresh, notify } = useStore();
  const params = useLocalSearchParams<{ item?: string }>();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const members = useResource(
    `/admin/members?query=${encodeURIComponent(query)}&page=${page}`,
  );
  const userId = params.item || members.data?.items[0]?.id;
  const member = useResource(userId ? `/admin/members/${userId}` : undefined);
  const user = member.data;
  const done = async () => {
    await member.reload();
    await members.reload();
    await refresh();
    notify("変更を保存しました");
  };
  if (screen.id === "A011")
    return (
      <Panel title={`会員一覧 · ${members.data?.total ?? 0}名`}>
        <label className="field">
          <span>ニックネーム・メールで検索</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        {members.error && <Notice>{members.error}</Notice>}
        <Table
          columns={["会員", "プラン", "状態", "メール確認", "操作"]}
          rows={(members.data?.items ?? []).map((item: any) => [
            item.profile.name,
            item.profile.plan,
            item.status === "active"
              ? "有効"
              : item.status === "closed"
                ? "退会済み"
                : "停止",
            item.verified ? "確認済み" : "未確認",
            <RouteLink id="A012" item={item.id} className="button ghost small">
              詳細
            </RouteLink>,
          ])}
        />
        <div className="button-row">
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            前の50件
          </Button>
          <span>{page}ページ</span>
          <Button
            disabled={page * 50 >= (members.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            次の50件
          </Button>
        </div>
      </Panel>
    );
  if (!user)
    return (
      <Panel>
        {member.error ? (
          <Notice>{member.error}</Notice>
        ) : (
          <Empty
            title="会員を選んでください"
            text="会員一覧から対象者を開けます。"
            action={<Button id="A011">会員一覧</Button>}
          />
        )}
      </Panel>
    );
  if (screen.id === "A012")
    return (
      <>
        <Panel title={user.profile.name}>
          <p>{user.email}</p>
          <Badge>{user.profile.plan}</Badge>
          <dl className="detail-grid">
            <dt>会員ID</dt>
            <dd>{user.id}</dd>
            <dt>メール確認</dt>
            <dd>{user.verified ? "確認済み" : "未確認"}</dd>
            <dt>状態</dt>
            <dd>
              {user.status === "active"
                ? "有効"
                : user.status === "closed"
                  ? "退会済み"
                  : "停止"}
            </dd>
            <dt>登録日</dt>
            <dd>{new Date(user.joined).toLocaleString("ja-JP")}</dd>
          </dl>
        </Panel>
        <Panel title="会員管理">
          {[
            ["A013", "プランの変更"],
            ["A014", "個別機能の権限"],
            ["A015", "警告・利用停止"],
            ["A016", "端末のログアウト"],
            ["A017", "開示・訂正・削除の対応"],
          ].map(([id, label]) => (
            <RouteLink key={id} id={id} item={user.id} className="button ghost">
              {label}
            </RouteLink>
          ))}
        </Panel>
      </>
    );
  if (screen.id === "A013")
    return (
      <Panel title={`${user.profile.name}のプラン変更`}>
        {role !== "super" ? (
          <Notice>プランの変更にはスーパー管理者権限が必要です。</Notice>
        ) : (
          <Form
            submit="プラン変更を確定"
            onSubmit={async (values) => {
              await api(
                `/admin/members/${user.id}/plan`,
                {
                  planId: values.planId,
                  ...(values.applyAt
                    ? { applyAt: new Date(values.applyAt).toISOString() }
                    : {}),
                  reason: values.reason,
                },
                "POST",
                "admin",
                crypto.randomUUID(),
              );
              await done();
            }}
          >
            <label className="field">
              <span>変更先のプラン</span>
              <select name="planId">
                {state.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              name="applyAt"
              label="適用日時（空欄は即時）"
              type="datetime-local"
            />
            <Field name="reason" label="変更理由" required />
            {user.planChanges?.map((change: any) => (
              <Notice key={change.id}>
                {new Date(change.applyAt).toLocaleString("ja-JP")}に変更予定
              </Notice>
            ))}
          </Form>
        )}
      </Panel>
    );
  if (screen.id === "A014")
    return (
      <Panel title={`${user.profile.name}の個別権限`}>
        <Form
          submit="期限付き権限を適用"
          onSubmit={async (values) => {
            await api(`/admin/users/${user.id}/overrides`, {
              feature: values.feature,
              allowed: values.allowed === "許可",
              expiresAt: new Date(values.expiresAt).toISOString(),
              reason: values.reason,
            });
            await done();
          }}
        >
          <label className="field">
            <span>対象機能</span>
            <select name="feature">
              {Object.entries(features).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Select
            name="allowed"
            label="許可・停止"
            options={["許可", "停止"]}
          />
          <Field
            name="expiresAt"
            label="終了日時"
            type="datetime-local"
            required
          />
          <Field name="reason" label="適用理由" required />
        </Form>
      </Panel>
    );
  if (screen.id === "A015")
    return (
      <Panel title={`${user.profile.name}への措置`}>
        <Form
          submit="措置を確定"
          tone="danger"
          onSubmit={async (values) => {
            await api(`/admin/members/${user.id}/status`, {
              action: (
                {
                  警告: "warn",
                  利用停止: "suspend",
                  停止解除: "restore",
                } as any
              )[values.action],
              ...(values.until
                ? { until: new Date(values.until).toISOString() }
                : {}),
              reason: values.reason,
            });
            await done();
          }}
        >
          <Select
            name="action"
            label="措置"
            options={["警告", "利用停止", "停止解除"]}
          />
          <Field
            name="until"
            label="停止期限（空欄は無期限）"
            type="datetime-local"
          />
          <Field name="reason" label="理由" multiline required />
          <label className="check-row">
            <input type="checkbox" required />
            対象会員と影響を確認しました
          </label>
        </Form>
      </Panel>
    );
  if (screen.id === "A016")
    return (
      <Panel title={`${user.profile.name}のログイン端末`}>
        <Table
          columns={["端末", "最終利用"]}
          rows={(user.sessions ?? []).map((session: any) => [
            session.agent,
            new Date(session.touched_at).toLocaleString("ja-JP"),
          ])}
        />
        <Form
          submit="全端末をログアウト"
          tone="danger"
          onSubmit={async (values) => {
            await api(`/admin/members/${user.id}/sessions/revoke`, {
              reason: values.reason,
            });
            await done();
          }}
        >
          <Field name="reason" label="失効理由" required />
        </Form>
      </Panel>
    );
  return (
    <>
      <Panel title={`${user.profile.name}からの依頼`}>
        <Form
          submit="本人確認済みの依頼を受け付ける"
          onSubmit={async (values) => {
            await api(`/admin/members/${user.id}/requests`, {
              type: values.type,
              verified: true,
              reason: values.reason,
            });
            await done();
          }}
        >
          <Select
            name="type"
            label="依頼内容"
            options={["データ開示", "情報訂正", "データ削除", "退会対応"]}
          />
          <Field
            name="reason"
            label="本人確認と対応の記録"
            multiline
            required
          />
          <label className="check-row">
            <input type="checkbox" required />
            本人確認を完了しました
          </label>
        </Form>
        <p>
          削除・退会は、契約・通報対応と保存義務を確認して対応記録を残してください。
        </p>
        {user.requests?.map((request: any) => (
          <Panel key={request.id} title={`${request.type} · ${request.status}`}>
            <p>{request.reason}</p>
            {request.status !== "対応完了" && (
              <Form
                submit="依頼の対応を更新"
                onSubmit={async (values) => {
                  await api(
                    `/admin/members/${user.id}/requests/${request.id}`,
                    {
                      status: values.status,
                      reason: values.reason,
                      ...(values.name ? { name: values.name } : {}),
                    },
                    "PATCH",
                  );
                  await done();
                }}
              >
                <Select
                  name="status"
                  label="対応状態"
                  options={["調査中", "対応完了", "却下"]}
                />
                {request.type === "情報訂正" && (
                  <Field name="name" label="訂正後のニックネーム" />
                )}
                <Field
                  name="reason"
                  label="対応記録・保存義務の確認"
                  multiline
                  required
                />
                <label className="check-row">
                  <input type="checkbox" required />
                  依頼内容と実行内容を確認しました
                </label>
              </Form>
            )}
            {request.resolution && <p>{request.resolution}</p>}
          </Panel>
        ))}
      </Panel>
      <Panel title="データ開示">
        <Form
          submit="開示データをダウンロード"
          onSubmit={async (values) => {
            const data = await api(`/admin/members/${user.id}/export`, {
              reason: values.reason,
              verified: true,
            });
            saveJson(data, `mangumi-account-${user.id}.json`);
          }}
        >
          <Field name="reason" label="開示理由と本人確認の記録" required />
          <label className="check-row">
            <input type="checkbox" required />
            本人からの依頼を確認しました
          </label>
        </Form>
      </Panel>
    </>
  );
}
