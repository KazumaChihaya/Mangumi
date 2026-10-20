import type { DemoState } from "./model";
import { nativeHost, nativeCall } from "./native-bridge";

export const apiBase = process.env.EXPO_PUBLIC_API_URL ?? "";
export const liveMode = !!apiBase;
export const currentArea = () =>
  typeof location !== "undefined" && /\/admin(?:\/|$)/.test(location.pathname)
    ? "admin"
    : "member";
const csrf: Record<string, string> = {};
const unsettled = new Map<string, string>();
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  area = currentArea(),
  key?: string,
): Promise<T> {
  if (nativeHost() && area === "member") {
    if (path === "/billing/checkout")
      return nativeCall("billing.checkout", body);
    if (path === "/billing/portal") return nativeCall("billing.manage");
    if (path === "/billing/cancel") {
      await nativeCall("billing.manage");
      throw new Error(
        "ストアの契約管理で解約してください。結果はストアからの通知後に反映されます",
      );
    }
    if (path === "/auth/logout" && method === "POST")
      await nativeCall("session.logout");
  }
  const fingerprint = key
    ? `${area}:${method}:${path}:${JSON.stringify(body)}`
    : "";
  const requestKey = fingerprint ? (unsettled.get(fingerprint) ?? key) : key;
  if (fingerprint && requestKey) unsettled.set(fingerprint, requestKey);
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: {
        ...(body instanceof FormData
          ? {}
          : body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        "X-Mangumi-Request": "1",
        "X-Mangumi-Area": area,
        "X-CSRF-Token": csrf[area] ?? "",
        ...(requestKey ? { "Idempotency-Key": requestKey } : {}),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "通信できませんでした。同じ操作を再試行できます",
      0,
      "network",
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (
    fingerprint &&
    (response.ok || (response.status < 500 && payload.code !== "processing"))
  )
    unsettled.delete(fingerprint);
  if (!response.ok)
    throw new ApiError(
      payload.message ?? "通信できませんでした",
      response.status,
      payload.code ?? "network",
    );
  if (payload.csrf) csrf[area] = payload.csrf;
  if (
    nativeHost() &&
    area === "member" &&
    path === "/me/close" &&
    method === "POST"
  )
    await nativeCall("session.logout").catch(() => {});
  return payload;
}
export async function session(area = currentArea()) {
  return api(
    area === "admin" ? "/admin/auth/session" : "/auth/session",
    undefined,
    "GET",
    area,
  );
}
export async function upload(
  file: Blob,
  kind: "avatar" | "image" | "audio" | "rewardImage" | "rewardAudio" | "video",
  conversationId?: string,
) {
  const form = new FormData();
  form.append("file", file, "upload");
  return api<{ id: string; url: string; duration?: number }>(
    `/uploads?kind=${kind}${conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : ""}`,
    form,
  );
}
export type Change = {
  resource: string;
  id?: string;
  before?: unknown;
  after?: unknown;
};
const localFields = new Set([
  "featureNames",
  "audit",
  "probabilityVersion",
  "probabilityVersions",
  "tipAmount",
  "tipMessage",
  "tipRecipient",
  "activeRoom",
  "speaking",
  "muted",
]);
export function stateChanges(previous: DemoState, next: DemoState): Change[] {
  const changes: Change[] = [];
  const equal = (first: unknown, second: unknown) =>
    JSON.stringify(first) === JSON.stringify(second);
  for (const resource of Object.keys(next) as (keyof DemoState)[]) {
    if (localFields.has(resource) || equal(previous[resource], next[resource]))
      continue;
    if (
      resource === "probabilities" ||
      resource === "gacha" ||
      resource === "reminders" ||
      typeof next[resource] === "boolean"
    ) {
      changes.push({
        resource,
        before: previous[resource],
        after: next[resource],
      });
    } else if (["profile", "settings"].includes(resource)) {
      const before: Record<string, unknown> = {},
        after: Record<string, unknown> = {};
      const oldValue = previous[resource] as unknown as Record<string, unknown>;
      const newValue = next[resource] as unknown as Record<string, unknown>;
      for (const field of Object.keys(newValue))
        if (!equal(oldValue[field], newValue[field])) {
          before[field] = oldValue[field];
          after[field] = newValue[field];
        }
      changes.push({ resource, before, after });
    } else if (resource === "records") {
      for (const record of new Set([
        ...Object.keys(previous.records),
        ...Object.keys(next.records),
      ]))
        if (!equal(previous.records[record], next.records[record]))
          changes.push({
            resource,
            id: record,
            before: previous.records[record],
            after: next.records[record],
          });
    } else if (Array.isArray(next[resource])) {
      const before = new Map(
        (previous[resource] as any[]).map((item) => [item.id, item]),
      );
      const after = new Map(
        (next[resource] as any[]).map((item) => [item.id, item]),
      );
      for (const id of new Set([...before.keys(), ...after.keys()]))
        if (!equal(before.get(id), after.get(id))) {
          let value = after.get(id);
          if (resource === "reports" && value)
            value = { status: value.status, assignee: value.assignee };
          changes.push({
            resource,
            id,
            before: before.get(id),
            after: value ?? null,
          });
        }
    }
  }
  return changes;
}
