import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { Screen } from "../registry";
import { useStore } from "../store";
import { safeLink } from "../model";
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
  Select,
  Table,
  Toggle,
  downloadCSV,
} from "../ui";
import { ConfigForm } from "./Common";
import { AssetUpload } from "./Content";
export function BrandPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const [logo, setLogo] = useState(
    state.records.A076?.logo ?? "/assets/hero_source.jpg",
  );
  const [icon, setIcon] = useState(
    state.records.A076?.icon ?? "/assets/avatar.jpg",
  );
  const [image, setImage] = useState(
    state.records.A078?.image ?? "/assets/hero_home.jpg",
  );
  const [error, setError] = useState("");
  if (screen.id === "A075")
    return (
      <>
        <div className="two-columns">
          <Panel title="公開プレビュー">
            <Hero
              asset="hero_home"
              label={state.settings.name}
              title="最高の瞬間を、一緒に。"
              text="利用者画面でブランドの雰囲気を確認できます。"
              action={
                <Button id="U022" tone="gold">
                  アプリを確認
                </Button>
              }
            />
          </Panel>
          <Panel title="ブランド設定">
            <Row title="ロゴ・アイコン" id="A076" />
            <Row title="テーマカラー" sub={state.settings.accent} id="A077" />
            <Row title="OGP・通知・メール素材" id="A078" />
            <Row title="インストール案内" id="A079" />
            <Row title="法務文書へのリンク" id="A081" />
          </Panel>
        </div>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "name",
              label: "アプリ表示名",
              value: state.settings.name,
              required: true,
            },
            { name: "short", label: "短縮名", value: "まんぞうラブ" },
            {
              name: "description",
              label: "説明",
              multiline: true,
              value: "マン組と、もっと近くに。最高のファン体験を。",
            },
          ]}
          onSave={(v) =>
            update((d) => {
              d.settings.name = v.name;
            }, "ブランド表示名変更")
          }
        />
      </>
    );
  if (screen.id === "A076")
    return (
      <Panel title="ブランド素材">
        <Form
          onSubmit={() => {
            update((d) => {
              d.records.A076 = { logo, icon };
            }, "ブランド素材変更");
            notify("ブランド素材のプレビューを保存しました");
          }}
        >
          <div className="two-columns">
            <div>
              <h3>ヘッダーロゴ</h3>
              <AssetUpload value={logo} onChange={setLogo} />
            </div>
            <div>
              <h3>PWAアイコン</h3>
              <AssetUpload value={icon} onChange={setIcon} />
            </div>
          </div>
          <Field
            name="alt"
            label="ロゴの代替テキスト"
            value={state.settings.name}
          />
          <Notice>
            インストール済みアイコンの即時変更は保証できません。本番素材のサイズ生成とManifest更新は配信APIへの接続時に実装します。
          </Notice>
        </Form>
      </Panel>
    );
  if (screen.id === "A077")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "accent",
            label: "主要ボタン色",
            type: "color",
            value: state.settings.accent,
          },
          { name: "theme", label: "テーマ色", type: "color", value: "#170c1e" },
          {
            name: "background",
            label: "背景色",
            type: "color",
            value: "#0b0810",
          },
        ]}
        onSave={(v) =>
          update((d) => {
            d.settings.accent = v.accent;
          }, "ブランドテーマ変更")
        }
      >
        <div className="color-swatch">
          <i style={{ background: state.settings.accent }} />
          <span>現在のアクセント {state.settings.accent}</span>
        </div>
      </ConfigForm>
    );
  if (screen.id === "A078")
    return (
      <Panel title="共有・通知素材">
        <Form
          onSubmit={(v) => {
            update((d) => {
              d.records.A078 = { ...v, image };
            }, "OGP素材変更");
            notify("共有素材の設定を保存しました");
          }}
        >
          <AssetUpload value={image} onChange={setImage} />
          <div className="field-grid">
            <Select
              label="用途"
              name="usage"
              options={["OGP画像", "メールロゴ", "通知アイコン"]}
            />
            <Field
              label="画像の説明"
              name="alt"
              value="まんぞうラブの公式ファンアプリ"
              required
            />
          </div>
          <Notice>
            公開メタデータへの反映は本番の素材配信・HTML生成に接続して行います。
          </Notice>
        </Form>
      </Panel>
    );
  if (screen.id === "A079")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "device",
            label: "対象環境",
            options: [
              "iPhone / iPad",
              "Android Chrome",
              "Windows / macOS",
              "非対応ブラウザ",
            ],
          },
          {
            name: "title",
            label: "案内タイトル",
            value: "ホーム画面に、マン組を。",
            required: true,
          },
          {
            name: "body",
            label: "案内本文",
            value: "ホーム画面に追加すると、アプリのように開けます。",
            multiline: true,
          },
          {
            name: "verified",
            label: "手順の最終確認日",
            type: "date",
            value: "2026-10-13",
          },
          { name: "status", label: "公開状態", options: ["公開", "非公開"] },
          { name: "order", label: "表示順", type: "number", value: 1, min: 1 },
        ]}
      >
        <Button id="U001" tone="ghost">
          利用者向け案内を確認
        </Button>
      </ConfigForm>
    );
  if (screen.id === "A080")
    return (
      <>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "asset",
              label: "対象素材",
              options: ["ブランド名", "ヘッダーロゴ", "PWAアイコン", "OGP画像"],
            },
            {
              name: "at",
              label: "公開予約日時",
              type: "datetime-local",
              required: true,
            },
            { name: "reason", label: "変更理由", required: true },
          ]}
          notice="本番の素材配信ジョブは未接続です。予約内容と変更履歴の確認用です。"
        />
        <Panel title="ブランド変更履歴">
          <Table
            columns={["操作", "日時", "理由", "操作"]}
            rows={state.audit
              .filter((a) => /ブランド|OGP/.test(a.action))
              .map((a) => [
                a.action,
                new Date(a.at).toLocaleString("ja-JP"),
                a.reason,
                <RouteLink
                  key={a.id}
                  id="A095"
                  item={a.id}
                  className="button ghost small"
                >
                  変更前後を確認
                </RouteLink>,
              ])}
          />
        </Panel>
      </>
    );
  return (
    <Panel title="法務文書のリンク">
      <Form
        onSubmit={(v) => {
          for (const value of Object.values(v))
            if (value && !safeLink(value)) {
              setError("HTTPSの正しいURLを入力してください");
              return;
            }
          update((d) => {
            d.records.A081 = v;
          }, "法務文書リンク変更");
          setError("");
          notify("リンクを保存しました");
        }}
      >
        <div className="field-grid">
          <Field
            name="terms"
            label="利用規約URL"
            type="url"
            value={state.records.A081?.terms}
          />
          <Field
            name="privacy"
            label="プライバシーポリシーURL"
            type="url"
            value={state.records.A081?.privacy}
          />
          <Field
            name="commerce"
            label="特定商取引法に基づく表記URL"
            type="url"
            value={state.records.A081?.commerce}
          />
          <Field
            name="guidelines"
            label="コミュニティガイドラインURL"
            type="url"
            value={state.records.A081?.guidelines}
          />
        </div>
        <Notice>
          正式な文書を確認してから公開してください。利用者画面の確認用文面は正式な条文ではありません。
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
      </Form>
    </Panel>
  );
}
export function SystemsPage({ screen }: { screen: Screen }) {
  const { state, update, notify, reset } = useStore();
  if (screen.id === "A082")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "sender",
            label: "送信者名",
            value: "まんぞうラブ運営",
            required: true,
          },
          {
            name: "from",
            label: "送信元メール",
            type: "email",
            value: "noreply@example.test",
          },
          {
            name: "subject",
            label: "確認メールの件名",
            value: "まんぞうラブのメール確認",
          },
          {
            name: "body",
            label: "確認メールの本文",
            multiline: true,
            value: "マン組へようこそ！確認リンクから登録を完了してください。",
          },
        ]}
        notice="メールサービスは未接続です。SPF・DKIM・DMARCは本番のドメインで設定します。秘密鍵やAPIシークレットはこの画面に保存しません。"
      />
    );
  if (screen.id === "A083")
    return (
      <>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "timings",
              label: "既定の配信リマインダー",
              value: state.reminders.join(", "),
            },
            {
              name: "interval",
              label: "DBジョブ確認間隔（秒）",
              type: "number",
              value: 10,
              min: 1,
            },
            {
              name: "retry",
              label: "最大再試行回数",
              type: "number",
              value: 3,
              min: 0,
              max: 10,
            },
            { name: "expired", label: "無効な購読", options: ["自動無効化"] },
          ]}
          notice="標準Push API・Notifications API・Service Worker・VAPIDを使用する構成です。配信サーバーは未接続です。"
        />
        <Panel title="端末の状態">
          <Table
            columns={["端末", "購読状態"]}
            rows={state.sessions.map((s) => [
              s.name,
              <Badge key={s.id} tone="gray">
                未接続
              </Badge>,
            ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A084")
    return (
      <>
        <Panel title="外部サービスの接続状態">
          <Table
            columns={["サービス", "用途", "接続状態"]}
            rows={[
              [
                "Stripe",
                "Web決済",
                <Badge key="stripe" tone="gray">
                  未接続
                </Badge>,
              ],
              [
                "LiveKit",
                "音声配信",
                <Badge key="livekit" tone="gray">
                  未接続
                </Badge>,
              ],
              [
                "メール配信",
                "確認メール・通知",
                <Badge key="mail" tone="gray">
                  未接続
                </Badge>,
              ],
              [
                "Web Push",
                "端末への通知",
                <Badge key="push" tone="gray">
                  未接続
                </Badge>,
              ],
              [
                "MariaDB / API",
                "本番のデータ",
                <Badge key="api" tone="gray">
                  未接続
                </Badge>,
              ],
            ]}
          />
        </Panel>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "api",
              label: "API公開URL",
              type: "url",
              value: "https://api.example.jp",
            },
            {
              name: "livekit",
              label: "LiveKit公開URL",
              type: "url",
              value: "https://live.example.jp",
            },
            { name: "mode", label: "接続モード", options: ["UIプレビュー"] },
          ]}
          notice="接続情報の確認用です。APIキー・暗号鍵・DB認証情報などの秘密情報は環境変数や秘密情報管理に保存します。"
        />
      </>
    );
  if (screen.id === "A085")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "retention",
            label: "メディア保存期間（日）",
            type: "number",
            value: state.settings.retention,
            min: 1,
          },
          {
            name: "dm",
            label: "DM保持期間（日）",
            type: "number",
            value: 90,
            min: 1,
          },
          {
            name: "backups",
            label: "バックアップ保持期間（日）",
            type: "number",
            value: 30,
            min: 1,
          },
          {
            name: "storage",
            label: "ファイル領域",
            value: "VPSローカル永続ボリューム",
          },
        ]}
        onSave={(v) =>
          update((d) => {
            d.settings.retention = Number(v.retention);
          }, "保存期間変更")
        }
        notice="削除ジョブとバックアップは本番API接続後に有効になります。法令・通報・決済紛争に必要な保存方針を公開前に確定します。"
      />
    );
  if (screen.id === "A086")
    return (
      <>
        <Panel title="メンテナンス表示">
          <Toggle
            label="メンテナンスモード"
            checked={state.settings.maintenance}
            onChange={(v) =>
              update((d) => {
                d.settings.maintenance = v;
              }, "メンテナンス切替")
            }
          />
          <Form
            onSubmit={(v) => {
              update((d) => {
                d.settings.maintenanceText = v.body;
              }, "メンテナンス文言変更");
              notify("表示文を保存しました");
            }}
          >
            <Field
              name="body"
              label="利用者向け表示文"
              value={state.settings.maintenanceText}
              multiline
              required
            />
            <Field name="end" label="終了予定日時" type="datetime-local" />
          </Form>
        </Panel>
        <Button id="U105" tone="gold">
          利用者側の表示を確認
        </Button>
      </>
    );
  if (screen.id === "A087")
    return (
      <>
        <Panel title="通知ジョブ">
          <Table
            columns={["ジョブ", "状態", "対象数", "操作"]}
            rows={state.campaigns.map((c) => [
              c.title,
              <Badge key="status">{c.status}</Badge>,
              c.count,
              <Button
                key="retry"
                tone="ghost"
                className="small"
                onClick={() => {
                  update(
                    (d) => {
                      const entry = d.campaigns.find((x) => x.id === c.id)!;
                      entry.status = "テスト再試行済み";
                    },
                    "通知ジョブ再試行",
                    c.title,
                  );
                  notify("再試行のプレビューを記録しました");
                }}
              >
                再試行を記録
              </Button>,
            ])}
          />
          <Notice>
            MariaDBを使う本番の通知ジョブは未接続です。Redisは使用しません。
          </Notice>
        </Panel>
        <Button id="A038" tone="ghost">
          通知結果を確認
        </Button>
      </>
    );
  if (screen.id === "A088")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          {
            name: "timeout",
            label: "管理セッションのタイムアウト（分）",
            type: "number",
            value: 30,
            min: 5,
            max: 1440,
          },
          {
            name: "ip",
            label: "許可するIPアドレス（任意・1行に1件）",
            multiline: true,
          },
          { name: "mfa", label: "二要素認証", options: ["必須"] },
          { name: "reason", label: "変更理由", required: true },
        ]}
        notice="本番のセッションとアクセス制限はAPI・リバースプロキシで適用します。プレビューではアクセスを遮断しません。"
      />
    );
  return (
    <>
      <Panel title="システムヘルス">
        <Table
          columns={["項目", "状態", "確認内容"]}
          rows={[
            [
              "Web UI",
              <Badge key="web" tone="green">
                稼働中
              </Badge>,
              "ブラウザで表示中",
            ],
            [
              "本番API",
              <Badge key="api" tone="gray">
                未接続
              </Badge>,
              "Fastify APIの接続待ち",
            ],
            [
              "データベース",
              <Badge key="db" tone="gray">
                未接続
              </Badge>,
              "MariaDB / 開発SQLite",
            ],
            [
              "音声サービス",
              <Badge key="rtc" tone="gray">
                未接続
              </Badge>,
              "LiveKit SFU",
            ],
            [
              "バックアップ",
              <Badge key="backup" tone="gray">
                未接続
              </Badge>,
              "本番の永続ボリューム接続待ち",
            ],
          ]}
        />
      </Panel>
      <Panel title="プレビューのデータ">
        <Row
          title="プレビューを初期化"
          sub="このブラウザ内のサンプルデータを初期状態へ戻します"
          end={
            <Button
              tone="ghost"
              onClick={() => {
                if (
                  window.confirm("プレビューの編集内容を初期状態に戻しますか？")
                )
                  reset();
              }}
            >
              初期化
            </Button>
          }
        />
      </Panel>
    </>
  );
}
export function AdministratorsPage({ screen }: { screen: Screen }) {
  const { state, update, notify } = useStore();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const [query, setQuery] = useState("");
  const audit = state.audit.find((a) => a.id === item) ?? state.audit[0];
  const exportAudit = () =>
    downloadCSV(
      "audit.csv",
      ["日時", "操作", "対象", "理由", "変更前", "変更後"],
      state.audit.map((a) => [
        a.at,
        a.action,
        a.target,
        a.reason,
        a.before,
        a.after,
      ]),
    );
  if (screen.id === "A090")
    return (
      <>
        <div className="toolbar">
          <Badge>ADMIN TEAM</Badge>
          <Button id="A091" icon="plus">
            管理者を追加
          </Button>
        </div>
        <Panel title="管理者アカウント">
          <Table
            columns={["管理者", "ロール", "二要素認証", "状態", "操作"]}
            rows={state.admins.map((a) => [
              a.name,
              a.role,
              <Badge key="mfa" tone={a.mfa ? "green" : "pink"}>
                {a.mfa ? "登録済み" : "未登録"}
              </Badge>,
              a.status,
              <Button
                key="disable"
                tone="ghost"
                className="small"
                disabled={a.id === "a1"}
                onClick={() => {
                  update(
                    (d) => {
                      d.admins.find((x) => x.id === a.id)!.status = "無効";
                    },
                    "管理者無効化",
                    a.name,
                  );
                  notify("管理者を無効化しました");
                }}
              >
                無効化
              </Button>,
            ])}
          />
        </Panel>
      </>
    );
  if (screen.id === "A091")
    return (
      <ConfigForm
        screen={screen}
        fields={[
          { name: "name", label: "管理者名", required: true },
          {
            name: "email",
            label: "メールアドレス",
            type: "email",
            required: true,
          },
          {
            name: "role",
            label: "管理ロール",
            options: [
              "コンテンツ管理者",
              "モデレーター",
              "サポート担当",
              "経理担当",
              "スーパー管理者",
            ],
          },
        ]}
        onSave={(v) =>
          update(
            (d) => {
              d.admins.push({
                id: crypto.randomUUID(),
                name: v.name,
                role: v.role,
                mfa: false,
                status: "招待中",
              });
            },
            "管理者追加プレビュー",
            v.name,
          )
        }
        notice="プレビュー内に管理者を追加します。招待メールは送信しません。"
      />
    );
  if (screen.id === "A092")
    return (
      <>
        <ConfigForm
          screen={screen}
          fields={[
            {
              name: "admin",
              label: "対象管理者",
              options: state.admins.map((a) => a.name),
            },
            {
              name: "role",
              label: "担当ロール",
              options: [
                "スーパー管理者",
                "コンテンツ管理者",
                "モデレーター",
                "サポート担当",
                "経理担当",
              ],
            },
            { name: "reason", label: "変更理由", required: true },
          ]}
          onSave={(v) =>
            update(
              (d) => {
                d.admins.find((a) => a.name === v.admin)!.role = v.role;
              },
              "管理者ロール変更",
              v.admin,
              v.reason,
            )
          }
        />
        <Panel title="ロールと基本権限">
          <Table
            columns={["ロール", "主な権限"]}
            rows={[
              ["スーパー管理者", "全権限・管理者追加・設定"],
              ["コンテンツ管理者", "配信・ストーリー・通知・ブランド"],
              ["モデレーター", "通報・DM調査・ルーム・停止"],
              ["サポート担当", "会員検索・問い合わせ"],
              ["経理担当", "売上・返金・CSV（DM本文は閲覧不可）"],
            ]}
          />
        </Panel>
      </>
    );
  if (screen.id === "A093")
    return (
      <Panel title="二要素認証の登録状況">
        {state.admins.map((a) => (
          <Row
            key={a.id}
            title={a.name}
            sub={a.role}
            end={
              <Badge tone={a.mfa ? "green" : "pink"}>
                {a.mfa ? "登録済み" : "登録待ち"}
              </Badge>
            }
          />
        ))}
        <Notice>
          管理者には二要素認証を必須にします。本番の登録・復旧は認証APIへ接続します。
        </Notice>
        <Button id="A002" tone="gold">
          認証画面の確認
        </Button>
      </Panel>
    );
  if (screen.id === "A094")
    return (
      <>
        <div className="toolbar">
          <label className="search-box">
            <Icon name="search" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="操作・対象・理由で検索"
              aria-label="監査ログを検索"
            />
          </label>
          <Button tone="ghost" icon="download" onClick={exportAudit}>
            監査CSV
          </Button>
        </div>
        <Panel title={`監査ログ / ${state.audit.length}件`}>
          <Table
            columns={["日時", "操作者", "操作", "対象", "理由", "詳細"]}
            rows={state.audit
              .filter((a) =>
                `${a.action} ${a.target} ${a.reason}`.includes(query),
              )
              .map((a) => [
                new Date(a.at).toLocaleString("ja-JP"),
                "運営管理者（プレビュー）",
                a.action,
                a.target,
                a.reason,
                <RouteLink
                  key={a.id}
                  id="A095"
                  item={a.id}
                  className="button ghost small"
                >
                  比較
                </RouteLink>,
              ])}
          />
          <Notice>監査ログを削除する操作は提供しません。</Notice>
        </Panel>
      </>
    );
  return (
    <>
      <Panel title="監査ログ詳細">
        {audit ? (
          <>
            <dl className="detail-grid">
              <dt>操作</dt>
              <dd>{audit.action}</dd>
              <dt>対象</dt>
              <dd>{audit.target}</dd>
              <dt>理由</dt>
              <dd>{audit.reason}</dd>
              <dt>日時</dt>
              <dd>{new Date(audit.at).toLocaleString("ja-JP")}</dd>
              <dt>操作者</dt>
              <dd>運営管理者（プレビュー）</dd>
            </dl>
            <div className="two-columns">
              <Panel title="変更前">
                <pre className="result-data">
                  {JSON.stringify(JSON.parse(audit.before), null, 2)}
                </pre>
              </Panel>
              <Panel title="変更後">
                <pre className="result-data">
                  {JSON.stringify(JSON.parse(audit.after), null, 2)}
                </pre>
              </Panel>
            </div>
          </>
        ) : (
          <Empty
            icon="shield"
            title="監査ログはまだありません"
            text="管理画面で変更すると、操作・対象・理由・変更前後を確認できます。"
          />
        )}
      </Panel>
      <Button tone="gold" onClick={exportAudit} icon="download">
        監査ログをCSV出力
      </Button>
    </>
  );
}
