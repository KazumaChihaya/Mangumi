type Host = { version: 1; platform: "ios" | "android"; nonce: string };
declare global {
  interface Window {
    MangumiNative?: Host;
    ReactNativeWebView?: { postMessage(value: string): void };
  }
}
const pending = new Map<
  string,
  {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export const nativeHost = () =>
  typeof window !== "undefined" ? window.MangumiNative : undefined;
let listening = false;
export function nativeCall<T = any>(
  method: string,
  params: unknown = {},
): Promise<T> {
  if (!nativeHost() || !window.ReactNativeWebView)
    return Promise.reject(new Error("端末アプリ専用の操作です"));
  if (!listening) {
    listening = true;
    window.addEventListener("mangumi-native-result", ((event: CustomEvent) => {
      const value = event.detail,
        request = pending.get(value?.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(value.id);
      if (value.error) request.reject(new Error(value.error));
      else request.resolve(value.result);
    }) as EventListener);
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error("端末の操作が完了しませんでした。再試行できます"));
      },
      method === "billing.checkout" ? 300000 : 45000,
    );
    pending.set(id, { resolve, reject, timer });
    window.ReactNativeWebView!.postMessage(
      JSON.stringify({ version: 1, id, method, params }),
    );
  });
}
