export interface TokenStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
};
export class NativeApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export class NativeSession {
  private tokens?: Tokens;
  private refreshing?: Promise<void>;
  private linking?: Promise<void>;
  constructor(
    public origin: string,
    public nonce: string,
    private storage: TokenStorage,
    private send: typeof fetch = fetch,
  ) {
    const url = new URL(origin);
    if (url.origin !== origin || !["https:", "http:"].includes(url.protocol))
      throw new Error("アプリのHTTPS接続先を設定してください");
  }
  get userId() {
    return this.tokens?.userId;
  }
  private async call(
    path: string,
    body?: unknown,
    method = "POST",
    token?: string,
    key?: string,
  ) {
    if (!path.startsWith("/api/") || path.includes("\\") || /[\r\n]/.test(path))
      throw new Error("無効なAPIパスです");
    let response: Response;
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 30000);
    try {
      response = await this.send(`${this.origin}${path}`, {
        method,
        credentials: "omit",
        signal: controller.signal,
        headers: {
          "X-Mangumi-Request": "1",
          "X-Mangumi-Area": "member",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
          ...(body instanceof FormData || body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      });
    } catch {
      throw new NativeApiError(
        "通信できませんでした。接続を確認して再試行してください",
        0,
        "network",
      );
    } finally {
      clearTimeout(timeout);
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new NativeApiError(
        result.message ?? "通信に失敗しました",
        response.status,
        result.code ?? "request_failed",
      );
    return result;
  }
  private async save(tokens: Tokens) {
    await this.storage.set(
      "mangumi.refresh",
      JSON.stringify({
        origin: this.origin,
        refreshToken: tokens.refreshToken,
      }),
    );
    this.tokens = tokens;
  }
  async link(code: string) {
    this.linking = (async () => {
      const result = await this.call("/api/native/exchange", {
        code,
        nonce: this.nonce,
      });
      await this.save(result);
    })().finally(() => {
      this.linking = undefined;
    });
    return this.linking;
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const stored = await this.storage.get("mangumi.refresh");
      let refreshToken: string | undefined;
      try {
        const parsed = JSON.parse(stored ?? "null");
        if (
          parsed?.origin === this.origin &&
          typeof parsed.refreshToken === "string"
        )
          refreshToken = parsed.refreshToken;
      } catch {}
      if (!refreshToken)
        throw new NativeApiError(
          "ログインしてください",
          401,
          "unauthenticated",
        );
      try {
        await this.save(
          await this.call("/api/native/refresh", {
            refreshToken,
            nonce: this.nonce,
          }),
        );
      } catch (error) {
        if (
          error instanceof NativeApiError &&
          [401, 403].includes(error.status)
        )
          await this.clear();
        throw error;
      }
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  async request(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    key?: string,
  ): Promise<any> {
    if (this.linking) await this.linking;
    if (!this.tokens || Date.parse(this.tokens.expiresAt) - Date.now() < 30000)
      await this.refresh();
    try {
      return await this.call(path, body, method, this.tokens!.accessToken, key);
    } catch (error) {
      if (!(error instanceof NativeApiError) || error.status !== 401)
        throw error;
      await this.refresh();
      return this.call(path, body, method, this.tokens!.accessToken, key);
    }
  }
  async webSource(path = "/") {
    const { ticket } = await this.request("/api/native/web-ticket", {
      path,
      nonce: this.nonce,
    });
    return {
      uri: `${this.origin}/api/native/web-login`,
      method: "POST" as const,
      headers: { "Content-Type": "application/json", "X-Mangumi-Request": "1" },
      body: JSON.stringify({ ticket, nonce: this.nonce }),
    };
  }
  async clear() {
    this.tokens = undefined;
    await this.storage.remove("mangumi.refresh");
  }
  async logout() {
    if (this.tokens || (await this.storage.get("mangumi.refresh")))
      await this.request("/api/native/logout", {});
    await this.clear();
  }
}
