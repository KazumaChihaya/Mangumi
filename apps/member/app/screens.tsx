import React, { useState } from "react";
import { screens, shortTitle } from "../src/registry";
import { useStore } from "../src/store";
import {
  Badge,
  Button,
  Icon,
  RouteLink,
  Select,
  SoundControls,
} from "../src/ui";
export default function Catalog() {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("すべて");
  const [kind, setKind] = useState("すべて");
  const { reset } = useStore();
  const filtered = screens.filter(
    (s) =>
      `${s.id} ${s.title} ${s.section}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (area === "すべて" ||
        s.area === (area === "利用者" ? "member" : "admin")) &&
      (kind === "すべて" || s.kind === kind),
  );
  return (
    <main className="catalog">
      <header className="catalog-header">
        <div>
          <span className="eyebrow">MANZOU LOVE / SCREEN EXPLORER</span>
          <h1>まんぞうラブ 全画面</h1>
          <p>
            利用者109項目 ＋ 管理95項目。画面・状態・モーダルを確認できます。
          </p>
        </div>
        <div className="button-row">
          <Button id="U022" tone="gold">
            アプリへ
          </Button>
          <Button id="A008" tone="ghost">
            管理画面へ
          </Button>
        </div>
      </header>
      <div className="toolbar">
        <label className="search-box">
          <Icon name="search" />
          <input
            placeholder="画面名・ID・カテゴリで検索"
            aria-label="画面を検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Select
          label="対象"
          name="area"
          options={["すべて", "利用者", "管理"]}
          value={area}
          onChange={setArea}
        />
        <Select
          label="種類"
          name="kind"
          options={["すべて", "画面", "UI状態", "モーダル", "共通部品"]}
          value={kind}
          onChange={setKind}
        />
        <Button
          tone="ghost"
          onClick={() => {
            if (window.confirm("プレビューの編集データを初期化しますか？"))
              reset();
          }}
        >
          プレビューを初期化
        </Button>
      </div>
      <div className="space-between" style={{ margin: "25px 0 18px" }}>
        <Badge>{filtered.length} / 204 SCREENS</Badge>
        <SoundControls />
      </div>
      <div className="catalog-grid">
        {filtered.map((s) => (
          <RouteLink key={s.id} id={s.id} className="catalog-card">
            <div>
              <Badge tone={s.area === "admin" ? "pink" : "gold"}>{s.id}</Badge>
              <Badge tone="gray">{s.kind}</Badge>
              <small>{s.phase}</small>
            </div>
            <strong>{shortTitle(s.title)}</strong>
            <small>
              {s.area === "admin" ? "管理画面" : "利用者"} / {s.section}
            </small>
          </RouteLink>
        ))}
      </div>
      {!filtered.length && (
        <p>一致する画面がありません。検索条件を変更してください。</p>
      )}
    </main>
  );
}
