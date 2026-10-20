import React, { useState } from "react";
import { Field, Form, Metric, Notice, Panel, Table } from "../ui";
import { useResource } from "./hooks";
import { yen } from "../model";
export function LiveRevenue() {
  const [filter, setFilter] = useState("");
  const report = useResource(`/admin/revenue${filter}`, 0);
  const total = report.data?.total;
  return (
    <Panel title="期間別・受取人別の売上">
      <Form
        submit="集計する"
        onSubmit={(v) => {
          const q = new URLSearchParams();
          if (v.from) q.set("from", new Date(v.from).toISOString());
          if (v.to) q.set("to", new Date(v.to).toISOString());
          if (v.recipient) q.set("recipient", v.recipient);
          setFilter(`?${q}`);
        }}
      >
        <Field name="from" label="開始日時" type="datetime-local" />
        <Field
          name="to"
          label="終了日時（この日時より前）"
          type="datetime-local"
        />
        <Field name="recipient" label="受取人ID（空欄は全員）" />
      </Form>
      {report.error && <Notice tone="error">{report.error}</Notice>}
      <Notice>{report.data?.definitions}</Notice>
      <h3>ストア購入</h3>
      <Notice>ストアが返す最小通貨単位で表示します。catalogは運営の設定価格で、実際の入金額の確定値ではありません。手数料・税・入金はストアの精算書と照合してください。コイン使用を売上へ再加算しません。</Notice>
      <Table columns={["購入ID","ストア","商品","種類","額（最小通貨単位）","通貨","価格の根拠","返金"]} rows={(report.data?.storePurchases ?? []).map((p:any)=>[p.id,p.platform,p.productId,p.kind,p.amount,p.currency,p.amountSource,p.revoked ? "返金・取消" : "有効"])} />
      <h3>コインによる応援</h3>
      <Table columns={["日時","応援ID","受取人","使用コイン","状態"]} rows={(report.data?.coinTips ?? []).map((p:any)=>[p.at,p.id,p.recipient,p.coins,p.status])}/>
      {total && (
        <div className="metric-grid">
          <Metric label="決済額" value={yen(total.gross)} />
          <Metric label="返金" value={yen(total.refunded)} />
          <Metric label="確定した手数料" value={yen(total.fees)} />
          <Metric
            label="差引売上"
            value={
              total.net === null
                ? `手数料取得待ち${total.feePending}件`
                : yen(total.net)
            }
          />
        </div>
      )}
      <Table
        columns={["受取人", "件数", "決済額", "返金", "手数料", "差引"]}
        rows={(report.data?.recipients ?? []).map((r: any) => [
          r.recipient,
          r.count,
          yen(r.gross),
          yen(r.refunded),
          yen(r.fees),
          r.net === null ? "未確定" : yen(r.net),
        ])}
      />
      <Table
        columns={[
          "決済ID",
          "日時",
          "種類",
          "受取人",
          "金額",
          "返金",
          "手数料",
          "状態",
        ]}
        rows={(report.data?.rows ?? []).map((r: any) => [
          r.id,
          new Date(r.at).toLocaleString("ja-JP"),
          r.kind,
          r.recipient,
          r.amount,
          r.refunded,
          r.fee === null ? "取得待ち" : r.fee,
          r.status,
        ])}
      />
    </Panel>
  );
}
