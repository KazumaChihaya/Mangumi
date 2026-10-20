import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NativeSession,
  NativeApiError,
  type TokenStorage,
} from "../src/client.ts";
import { localDestination } from "../src/navigation.ts";
const origin = "https://mangumi.example.test";
function fixture(send: typeof fetch) {
  const values = new Map<string, string>();
  const storage: TokenStorage = {
    get: async (k) => values.get(k) ?? null,
    set: async (k, v) => {
      values.set(k, v);
    },
    remove: async (k) => {
      values.delete(k);
    },
  };
  return {
    values,
    storage,
    session: new NativeSession(
      origin,
      "installation-binding-test",
      storage,
      send,
    ),
  };
}
const tokens = (
  suffix: string,
  expiresAt = new Date(Date.now() + 3600000).toISOString(),
) => ({
  userId: "synthetic-user",
  accessToken: `access-${suffix}-test-only`,
  refreshToken: `refresh-${suffix}-test-only`,
  expiresAt,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("native credentials stay outside WebView source and every API transport omits cookies", async () => {
  const requests: { url: string; options: RequestInit }[] = [];
  const f = fixture(async (input, options) => {
    requests.push({ url: String(input), options: options! });
    return String(input).endsWith("exchange")
      ? json(tokens("linked"))
      : json({ ticket: "single-use-ticket" });
  });
  await f.session.link("one-time-link-code");
  const source = await f.session.webSource("/u/U022"),
    stored = f.values.get("mangumi.refresh")!;
  assert.ok(stored.includes(origin));
  assert.ok(!stored.includes("access-linked"));
  assert.ok(!JSON.stringify(source).includes("refresh-linked"));
  assert.ok(!JSON.stringify(source).includes("access-linked"));
  assert.equal(source.method, "POST");
  assert.match(source.body, /single-use-ticket/);
  for (const request of requests) {
    assert.equal(request.options.credentials, "omit");
    assert.equal(
      new Headers(request.options.headers).get("X-Mangumi-Request"),
      "1",
    );
  }
});
test("parallel native requests rotate one refresh credential and share the resulting access token", async () => {
  let refreshes = 0;
  const f = fixture(async (input, options) => {
    const url = String(input);
    if (url.endsWith("exchange"))
      return json(tokens("old", new Date(Date.now() - 1000).toISOString()));
    if (url.endsWith("refresh")) {
      refreshes++;
      await new Promise((r) => setTimeout(r, 5));
      return json(tokens("new"));
    }
    assert.equal(
      new Headers(options!.headers).get("Authorization"),
      "Bearer access-new-test-only",
    );
    return json({ ok: true });
  });
  await f.session.link("link-code");
  await Promise.all(
    Array.from({ length: 5 }, () => f.session.request("/api/me/sessions")),
  );
  assert.equal(refreshes, 1);
  assert.match(f.values.get("mangumi.refresh")!, /refresh-new/);
});
test("network failure preserves secure credentials, revocation clears them, and another origin cannot receive them", async () => {
  let mode = "offline";
  const f = fixture(async () => {
    if (mode === "offline") throw new Error("network");
    return json({ message: "revoked" }, 401);
  });
  f.values.set(
    "mangumi.refresh",
    JSON.stringify({ origin, refreshToken: "refresh-retained" }),
  );
  await assert.rejects(
    f.session.refresh(),
    (error: any) => error instanceof NativeApiError && error.status === 0,
  );
  assert.ok(f.values.has("mangumi.refresh"));
  mode = "revoked";
  await assert.rejects(f.session.refresh());
  assert.equal(f.values.has("mangumi.refresh"), false);
  let calls = 0;
  const other = fixture(async () => {
    calls++;
    return json(tokens("wrong"));
  });
  other.values.set(
    "mangumi.refresh",
    JSON.stringify({
      origin: "https://other.example.test",
      refreshToken: "must-not-leak",
    }),
  );
  await assert.rejects(other.session.refresh());
  assert.equal(calls, 0);
});
test("notification and deep-link destinations remain within the configured application origin", () => {
  assert.equal(
    localDestination("mangumi://u/U011?token=synthetic", origin),
    "/u/U011?token=synthetic",
  );
  assert.equal(
    localDestination(`${origin}/space?item=room`, origin),
    "/space?item=room",
  );
  for (const value of [
    "//outside.example.test",
    "https://mangumi.example.test.evil.test/",
    "javascript:alert(1)",
    "/\\outside.example.test",
    "/\r\nLocation: https://outside.test",
    {},
  ])
    assert.equal(localDestination(value, origin), "/");
});

test("overlapping WebView handshakes cannot overwrite the latest native session with an older credential", async () => {
  const seen: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(async (input, options) => {
    if (String(input).endsWith("exchange")) {
      const body = JSON.parse(String(options!.body));
      seen.push(body.code);
      if (body.code === "first") await gate;
      return json(tokens(body.code));
    }
    assert.equal(
      new Headers(options!.headers).get("Authorization"),
      "Bearer access-second-test-only",
    );
    return json({ ok: true });
  });
  const first = f.session.link("first"),
    second = f.session.link("second"),
    request = f.session.request("/api/me/sessions");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, ["first"]);
  release();
  await Promise.all([first, second, request]);
  assert.deepEqual(seen, ["first", "second"]);
});

test("logout clears a revoked or closed account while a connection failure remains retryable", async () => {
  let closed = false;
  const f = fixture(async () => {
    if (!closed) throw new Error("offline");
    return json({ message: "account closed" }, 401);
  });
  f.values.set(
    "mangumi.refresh",
    JSON.stringify({ origin, refreshToken: "synthetic-old-device-token" }),
  );
  await assert.rejects(f.session.logout());
  assert.ok(f.values.has("mangumi.refresh"));
  closed = true;
  await f.session.logout();
  assert.equal(f.values.has("mangumi.refresh"), false);
  assert.equal(f.session.userId, undefined);
});
