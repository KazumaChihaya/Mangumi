import React, { useId, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { screenPath } from "./registry";
import { useStore } from "./store";
type IconName =
  | "home"
  | "calendar"
  | "mic"
  | "dm"
  | "user"
  | "bell"
  | "heart"
  | "star"
  | "chevron"
  | "back"
  | "menu"
  | "sound"
  | "mute"
  | "spark"
  | "ticket"
  | "shield"
  | "gear"
  | "search"
  | "play"
  | "check"
  | "close"
  | "plus"
  | "download"
  | "logout";
const paths: Record<IconName, string> = {
  home: "M3 10 12 3l9 7v10H15v-6H9v6H3Z",
  calendar: "M4 5h16v16H4ZM4 10h16M8 3v4m8-4v4",
  mic: "M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v1a7 7 0 0 0 14 0v-1M12 18v4m-4 0h8",
  dm: "M3 4h18v13H9l-6 4Z",
  user: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM4 21v-3a8 8 0 0 1 16 0v3",
  bell: "M6 10a6 6 0 0 1 12 0v6l2 3H4l2-3ZM10 22h4",
  heart: "M12 21 3.5 12.5A5.5 5.5 0 0 1 12 5a5.5 5.5 0 0 1 8.5 7.5Z",
  star: "m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z",
  chevron: "m9 5 7 7-7 7",
  back: "m15 5-7 7 7 7",
  menu: "M4 6h16M4 12h16M4 18h16",
  sound: "M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  mute: "M3 9h4l5-5v16l-5-5H3ZM17 9l5 6m0-6-5 6",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3ZM21 2v4m-2-2h4",
  ticket: "M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4ZM15 5v14",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6ZM8 12l3 3 5-6",
  gear: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM9 2h6l1 4 4 1 2 5-3 3 1 5-5 2-3-3-5 1-3-5 3-3-1-5 5-2Z",
  search: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 7 7",
  play: "m8 3 14 9-14 9Z",
  check: "m4 12 5 5L20 6",
  close: "m5 5 14 14M19 5 5 19",
  plus: "M12 4v16M4 12h16",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  logout: "M10 3H3v18h7M8 12h14m-5-5 5 5-5 5",
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function RouteLink({
  id,
  children,
  className = "",
  item,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  item?: string;
}) {
  const router = useRouter();
  const href =
    screenPath(id) + (item ? `?item=${encodeURIComponent(item)}` : "");
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          router.push(href as Href);
        }
      }}
    >
      {children}
    </a>
  );
}
export function Button({
  children,
  onClick,
  id,
  tone = "primary",
  disabled,
  type = "button",
  className = "",
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  id?: string;
  tone?: "primary" | "gold" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  icon?: IconName;
}) {
  const content = (
    <>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </>
  );
  if (id)
    return (
      <RouteLink id={id} className={`button ${tone} ${className}`}>
        {content}
      </RouteLink>
    );
  return (
    <button
      type={type}
      className={`button ${tone} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {content}
    </button>
  );
}
export function Panel({
  children,
  title,
  action,
  className = "",
}: {
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Badge({
  children,
  tone = "gold",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Field({
  label,
  name,
  type = "text",
  value,
  placeholder,
  required,
  min,
  max,
  help,
  multiline = false,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  help?: string;
  multiline?: boolean;
  onChange?: (value: string) => void;
}) {
  const uniqueId = useId();
  const id = `${name}-${uniqueId}`;
  const props = {
    id,
    name,
    "aria-label": label,
    defaultValue: onChange ? undefined : value,
    value: onChange ? value : undefined,
    placeholder,
    required,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange?.(event.target.value),
  };
  return (
    <label className="field" htmlFor={id}>
      <span>
        {label}
        {required && <small>必須</small>}
      </span>
      {multiline ? (
        <textarea {...props} rows={4} />
      ) : (
        <input
          {...props}
          type={type}
          min={min}
          max={max}
          minLength={type === "password" ? 12 : undefined}
          autoComplete={
            type === "password"
              ? "new-password"
              : type === "email"
                ? "email"
                : "off"
          }
        />
      )}
      {help && <em>{help}</em>}
    </label>
  );
}
export function Select({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: string[];
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        name={name}
        aria-label={label}
        defaultValue={onChange ? undefined : value}
        value={onChange ? value : undefined}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
export function Form({
  children,
  onSubmit,
  submit = "保存する",
  tone = "primary",
}: {
  children: React.ReactNode;
  onSubmit: (values: Record<string, string>) => void;
  submit?: string;
  tone?: "primary" | "gold" | "danger";
}) {
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        const values = Object.fromEntries(
          new FormData(event.currentTarget).entries(),
        ) as Record<string, string>;
        onSubmit(values);
      }}
    >
      {children}
      <Button type="submit" tone={tone}>
        {submit}
        <Icon name="chevron" size={16} />
      </Button>
    </form>
  );
}
export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}
export function Row({
  title,
  sub,
  id,
  item,
  image,
  end,
}: {
  title: string;
  sub?: string;
  id?: string;
  item?: string;
  image?: string;
  end?: React.ReactNode;
}) {
  const content = (
    <>
      {image && <img src={image} className="row-image" alt="" />}
      <span className="row-content">
        <strong>{title}</strong>
        {sub && <small>{sub}</small>}
      </span>
      {end ?? <Icon name="chevron" size={16} />}
    </>
  );
  return id ? (
    <RouteLink id={id} item={item} className="row">
      {content}
    </RouteLink>
  ) : (
    <div className="row">{content}</div>
  );
}
export function Empty({
  icon = "spark",
  title,
  text,
  action,
}: {
  icon?: IconName;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={36} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Notice({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <div className={`notice ${tone}`}>{children}</div>;
}
export function Metric({
  label,
  value,
  change,
  icon = "star",
}: {
  label: string;
  value: string | number;
  change?: string;
  icon?: IconName;
}) {
  return (
    <div className="metric">
      <span className="metric-icon">
        <Icon name={icon} />
      </span>
      <small>{label}</small>
      <strong>{value}</strong>
      {change && <span>{change}</span>}
    </div>
  );
}
export function Hero({
  asset,
  label,
  title,
  text,
  action,
}: {
  asset: string;
  label: string;
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="hero">
      <img src={`/assets/${asset}.jpg`} alt="" />
      <div className="hero-overlay" />
      <div className="hero-content">
        <Badge tone="pink">{label}</Badge>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
        {action}
      </div>
      <div className="hero-corner">MANZOU LOVE</div>
    </section>
  );
}
export function Confirm({
  title,
  text,
  action,
  reason = false,
  onConfirm,
  back,
}: {
  title: string;
  text: string;
  action: string;
  reason?: boolean;
  onConfirm: (reason: string) => void;
  back: string;
}) {
  const [error, setError] = useState("");
  return (
    <Panel className="confirmation">
      <Empty icon="shield" title={title} text={text} />
      <Form
        onSubmit={(values) => {
          if (reason && !values.reason?.trim()) {
            setError("操作理由を入力してください");
            return;
          }
          onConfirm(values.reason ?? "本人による確認");
        }}
        submit={action}
        tone="danger"
      >
        {reason && <Field name="reason" label="操作理由" required multiline />}
        {error && <Notice tone="error">{error}</Notice>}
        <label className="check-row">
          <input type="checkbox" required />
          内容を確認しました
        </label>
      </Form>
      <Button id={back} tone="ghost">
        キャンセル
      </Button>
    </Panel>
  );
}
export function downloadCSV(
  name: string,
  headers: string[],
  rows: (string | number | boolean)[][],
) {
  const escape = (value: string | number | boolean) => {
    let text = String(value);
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv =
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
export function Table({
  columns,
  rows,
  empty = "データがありません",
}: {
  columns: string[];
  rows: React.ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="table-empty">{empty}</p>}
    </div>
  );
}
export function SoundControls() {
  const { sound, toggleSound, reduced, toggleMotion } = useStore();
  return (
    <div className="effect-controls">
      <button
        onClick={toggleSound}
        aria-label={sound ? "効果音をOFF" : "効果音をON"}
        aria-pressed={sound}
      >
        <Icon name={sound ? "sound" : "mute"} size={17} />
        <span>音 {sound ? "ON" : "OFF"}</span>
      </button>
      <button onClick={toggleMotion} aria-pressed={reduced}>
        <Icon name="spark" size={17} />
        <span>{reduced ? "演出ひかえめ" : "演出ON"}</span>
      </button>
    </div>
  );
}
