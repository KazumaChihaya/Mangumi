import { Platform } from "react-native";
import * as IAP from "expo-iap";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type { NativeSession } from "./client";
export type Checkout =
  | {
      kind: "tip";
      amount: number;
      recipient: string;
      message: string;
      visibility?: "private" | "public";
    }
  | { kind: "plan"; planId: string; period?: string }
  | { kind: "setup" };
export type Paywall = {
  request: Checkout;
  products: any[];
  balance: number;
  buy: (product: any) => Promise<void>;
  cancel: () => void;
};
export class NativeBilling {
  private updated?: ReturnType<typeof IAP.purchaseUpdatedListener>;
  private errors?: ReturnType<typeof IAP.purchaseErrorListener>;
  private ready?: Promise<void>;
  private inFlight = new Map<string, Promise<void>>();
  private checkout?: {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  };
  private activeIntent?: string;
  constructor(
    private session: NativeSession,
    private show: (paywall: Paywall | null) => void,
    private warn: (text: string) => void,
  ) {}
  async connect() {
    if (this.ready) return this.ready;
    this.updated = IAP.purchaseUpdatedListener((p) => {
      void this.complete(p).catch((e) => this.warn(e.message));
    });
    this.errors = IAP.purchaseErrorListener((e) => {
      void this.failed(e);
    });
    this.ready = IAP.initConnection()
      .then(() => {})
      .catch((error) => {
        this.updated?.remove();
        this.errors?.remove();
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }
  private async failed(error: { code?: IAP.ErrorCode }) {
    if (error.code === IAP.ErrorCode.UserCancelled && this.activeIntent) {
      await this.session
        .request(`/api/native/store/intents/${this.activeIntent}/cancel`, {})
        .catch(() => {});
      await SecureStore.deleteItemAsync("mangumi.purchase");
      this.activeIntent = undefined;
    }
    this.checkout?.reject(
      new Error(
        error.code === IAP.ErrorCode.UserCancelled
          ? "購入をキャンセルしました"
          : "購入を確認できません。ストアの状態を確認して再試行してください",
      ),
    );
    this.checkout = undefined;
    this.show(null);
  }
  private complete(purchase: IAP.Purchase) {
    const key = purchase.id ?? purchase.purchaseToken ?? purchase.productId;
    if (this.inFlight.has(key)) return this.inFlight.get(key)!;
    const task = (async () => {
      if (purchase.purchaseState !== "purchased") return;
      if (!purchase.purchaseToken)
        throw new Error("ストアの購入証明が届いていません");
      const raw = await SecureStore.getItemAsync("mangumi.purchase"),
        pending = raw ? JSON.parse(raw) : undefined;
      if (pending && pending.userId !== this.session.userId)
        throw new Error("購入したアカウントでログインしてください");
      const intentId =
        pending?.productId === purchase.productId
          ? pending.intentId
          : undefined;
      const result = await this.session.request("/api/native/store/verify", {
        platform: Platform.OS,
        productId: purchase.productId,
        proof: purchase.purchaseToken,
        ...(intentId ? { intentId } : {}),
      });
      if (!result.accepted) throw new Error("購入を確認中です");
      await IAP.finishTransaction({
        purchase,
        isConsumable: result.kind === "coins",
      });
      if (intentId && result.intentId === intentId) {
        await SecureStore.deleteItemAsync("mangumi.purchase");
        this.activeIntent = undefined;
        this.checkout?.resolve({
          url: `${this.session.origin}/u/U100`,
          ...result,
        });
        this.checkout = undefined;
        this.show(null);
      }
    })().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }
  async restore() {
    await this.connect();
    const purchases = await IAP.getAvailablePurchases();
    for (const p of purchases) await this.complete(p);
    return { count: purchases.length };
  }
  async manage() {
    await IAP.deepLinkToSubscriptions();
    return { url: `${this.session.origin}/u/U089` };
  }
  async open(request: Checkout) {
    if (request.kind === "setup") return this.manage();
    if (this.checkout) throw new Error("先の購入操作を完了してください");
    if (this.activeIntent) {
      await this.restore();
      if (this.activeIntent)
        throw new Error(
          "先の購入はストアで処理中です。購入の復元から確認できます",
        );
    }
    const catalog = await this.session.request("/api/native/store/catalog");
    if (!catalog.enabled) throw new Error("現在は購入を受付していません");
    if (request.kind === "tip" && catalog.balance >= request.amount) {
      await this.session.request(
        "/api/native/tips",
        {
          amount: request.amount,
          recipient: request.recipient,
          message: request.message,
          visibility: request.visibility ?? "private",
        },
        "POST",
        Crypto.randomUUID(),
      );
      return { url: `${this.session.origin}/u/U100` };
    }
    const products = catalog.products.filter(
      (p: any) =>
        p.platform === Platform.OS &&
        (request.kind === "tip"
          ? p.kind === "coins" && p.credits + catalog.balance >= request.amount
          : p.kind === "subscription" &&
            p.planId === request.planId &&
            (p.period ?? "month") === (request.period ?? "month")),
    );
    if (!products.length)
      throw new Error(
        "対応するストア商品が未設定です。運営へお問い合わせください",
      );
    await this.connect();
    const fetched = await IAP.fetchProducts({
      skus: products.map((p: any) => p.productId),
      type: request.kind === "tip" ? "in-app" : "subs",
    });
    const choices = products
      .map((p: any) => ({
        ...p,
        store: fetched?.find((i) => i.id === p.productId),
      }))
      .filter((p: any) => p.store);
    if (!choices.length)
      throw new Error(
        "ストアから商品を取得できません。ストアのログイン状態を確認してください",
      );
    return new Promise((resolve, reject) => {
      this.checkout = { resolve, reject };
      this.show({
        request,
        products: choices,
        balance: catalog.balance,
        cancel: () => {
          if (this.activeIntent) {
            this.warn("ストアで支払いを確認中です。完了後に購入が反映されます");
            this.checkout?.resolve({
              url: `${this.session.origin}/u/U100?payment=processing`,
            });
            this.checkout = undefined;
            this.show(null);
            return;
          }
          this.checkout = undefined;
          this.show(null);
          reject(new Error("購入をキャンセルしました"));
        },
        buy: async (product) => {
          if (this.activeIntent) throw new Error("支払いを確認中です");
          const intent = await this.session.request(
            "/api/native/store/intents",
            {
              platform: Platform.OS,
              productId: product.productId,
              ...(request.kind === "tip"
                ? {
                    tip: {
                      amount: request.amount,
                      recipient: request.recipient,
                      message: request.message,
                      visibility: request.visibility ?? "private",
                    },
                  }
                : {}),
            },
            "POST",
            Crypto.randomUUID(),
          );
          this.activeIntent = intent.intentId;
          await SecureStore.setItemAsync(
            "mangumi.purchase",
            JSON.stringify({
              intentId: intent.intentId,
              productId: product.productId,
              userId: this.session.userId,
            }),
          );
          const apple = {
            sku: product.productId,
            appAccountToken: intent.accountToken,
            andDangerouslyFinishTransactionAutomatically: false,
          };
          const google = {
            skus: [product.productId],
            obfuscatedAccountId: intent.obfuscatedAccountId,
          };
          try {
            if (product.kind === "subscription") {
              const offers = product.store.subscriptionOffers ?? [],
                androidOffers = offers
                  .filter((o: any) => o.offerTokenAndroid)
                  .map((o: any) => ({
                    sku: product.productId,
                    offerToken: o.offerTokenAndroid,
                  }));
              await IAP.requestPurchase({
                type: "subs",
                request: {
                  apple,
                  google: {
                    ...google,
                    ...(androidOffers.length
                      ? { subscriptionOffers: androidOffers }
                      : {}),
                  },
                },
              });
            } else
              await IAP.requestPurchase({
                type: "in-app",
                request: { apple, google },
              });
          } catch (error) {
            await this.failed(error as { code?: IAP.ErrorCode });
            throw error;
          }
        },
      });
    });
  }
  async close() {
    this.updated?.remove();
    this.errors?.remove();
    await IAP.endConnection();
    this.ready = undefined;
  }
}
