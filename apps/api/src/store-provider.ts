import { readFileSync } from "node:fs";
import {
  SignedDataVerifier,
  Environment,
} from "@apple/app-store-server-library";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import type { Config } from "./config.ts";
import { digest, fail } from "./security.ts";
export type StoreProof = {
  platform: "ios" | "android";
  productId: string;
  proof: string;
};
export type StoreTransaction = {
  platform: "ios" | "android";
  id: string;
  originalId: string;
  productId: string;
  accountId: string;
  purchasedAt: string;
  expiresAt?: string;
  revoked: boolean;
  quantity: number;
  amount?: number;
  currency?: string;
};
export function storeServices(config: Config) {
  let apple: SignedDataVerifier | undefined;
  const google = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const appleVerifier = () => {
    if (!config.appleBundleId || !config.appleRootCertificates)
      fail(503, "App Storeの検証設定が必要です");
    if (
      !["Sandbox", "Production"].includes(config.appleEnvironment) ||
      (config.appleEnvironment === "Production" && !config.appleAppId)
    )
      fail(503, "App Storeの環境とApp IDを設定してください");
    if (!apple) {
      const roots = config.appleRootCertificates
        .split(";")
        .filter(Boolean)
        .map((p) => readFileSync(p));
      if (!roots.length)
        fail(503, "Appleの信頼済みルート証明書を設定してください");
      const environment =
        config.appleEnvironment === "Sandbox"
          ? Environment.SANDBOX
          : Environment.PRODUCTION;
      apple = new SignedDataVerifier(
        roots,
        true,
        environment,
        config.appleBundleId,
        config.appleAppId,
      );
    }
    return apple;
  };
  const decodeApple = async (proof: string): Promise<StoreTransaction> => {
    const data = await appleVerifier().verifyAndDecodeTransaction(proof);
    if (
      !data.transactionId ||
      !data.productId ||
      !data.appAccountToken ||
      !data.purchaseDate ||
      data.quantity !== 1
    )
      fail(403, "購入情報を確認できません");
    return {
      platform: "ios",
      id: data.transactionId,
      originalId: data.originalTransactionId ?? data.transactionId,
      productId: data.productId,
      accountId: data.appAccountToken,
      purchasedAt: new Date(data.purchaseDate).toISOString(),
      ...(data.expiresDate
        ? { expiresAt: new Date(data.expiresDate).toISOString() }
        : {}),
      revoked: !!data.revocationDate,
      quantity: 1,
      ...(data.price !== undefined
        ? {
            amount: Math.round(
              (data.price *
                10 **
                  (new Intl.NumberFormat("en", {
                    style: "currency",
                    currency: data.currency ?? "JPY",
                  }).resolvedOptions().maximumFractionDigits ?? 2)) /
                1000,
            ),
          }
        : {}),
      currency: data.currency,
    };
  };
  return {
    async storeReady(platform: "ios" | "android") {
      if (platform === "ios") {
        appleVerifier();
        return;
      }
      if (!config.googlePackage) fail(503, "Google Playの検証設定が必要です");
      await (await google.getClient()).getAccessToken();
    },
    async verifyStore(
      input: StoreProof,
      kind: "coins" | "subscription",
    ): Promise<StoreTransaction> {
      if (input.platform === "ios") return decodeApple(input.proof);
      if (!config.googlePackage) fail(503, "Google Playの検証設定が必要です");
      const client = await google.getClient(),
        group = kind === "subscription" ? "subscriptionsv2" : "productsv2";
      const { data } = await client.request<any>({
        url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(config.googlePackage)}/purchases/${group}/tokens/${encodeURIComponent(input.proof)}`,
        timeout: 15000,
      });
      const sandbox = !!data.testPurchaseContext || !!data.testPurchase;
      if (sandbox && config.appleEnvironment !== "Sandbox")
        fail(403, "テスト購入はテスト用サーバーで確認してください");
      if (kind === "subscription") {
        const item = data.lineItems?.find((i: any) =>
          input.productId
            ? i.productId === input.productId
            : data.lineItems.length === 1,
        );
        const active = [
          "SUBSCRIPTION_STATE_ACTIVE",
          "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
          "SUBSCRIPTION_STATE_CANCELED",
        ].includes(data.subscriptionState);
        if (
          !item?.expiryTime ||
          !data.externalAccountIdentifiers?.obfuscatedExternalAccountId
        )
          fail(403, "契約情報を確認できません");
        return {
          platform: "android",
          id: data.latestOrderId ?? `${digest(input.proof)}:${item.expiryTime}`,
          originalId: digest(input.proof),
          productId: item.productId,
          accountId:
            data.externalAccountIdentifiers.obfuscatedExternalAccountId,
          purchasedAt: new Date(data.startTime).toISOString(),
          expiresAt: new Date(item.expiryTime).toISOString(),
          revoked: !active,
          quantity: 1,
        };
      }
      const item = data.productLineItem?.find((i: any) =>
        input.productId
          ? i.productId === input.productId
          : data.productLineItem.length === 1,
      );
      if (
        !item ||
        !data.obfuscatedExternalAccountId ||
        !data.purchaseCompletionTime ||
        (item.productOfferDetails?.quantity ?? 1) !== 1
      )
        fail(403, "購入情報を確認できません");
      if (data.purchaseStateContext?.purchaseState === "PENDING")
        fail(409, "ストアでの支払いを確認中です", "processing");
      return {
        platform: "android",
        id: digest(input.proof),
        originalId: digest(input.proof),
        productId: item.productId,
        accountId: data.obfuscatedExternalAccountId,
        purchasedAt: new Date(data.purchaseCompletionTime).toISOString(),
        revoked: data.purchaseStateContext?.purchaseState !== "PURCHASED",
        quantity: 1,
      };
    },
    async appleNotification(signedPayload: string) {
      const notification =
        await appleVerifier().verifyAndDecodeNotification(signedPayload);
      if (!notification.notificationUUID) fail(400, "通知IDがありません");
      if (notification.notificationType === "TEST")
        return {
          eventId: notification.notificationUUID,
          transaction: undefined,
          reversed: false,
        };
      if (!notification.data?.signedTransactionInfo)
        fail(400, "対象の購入情報がありません");
      return {
        eventId: notification.notificationUUID,
        transaction: await decodeApple(notification.data.signedTransactionInfo),
        reversed: notification.notificationType === "REFUND_REVERSED",
      };
    },
    async googleNotification(authorization: string) {
      if (!config.googleNotificationAudience || !config.googleNotificationEmail)
        fail(503, "Google通知の署名検証設定が必要です");
      const token = /^Bearer (.+)$/.exec(authorization)?.[1];
      if (!token) fail(403, "通知の署名を確認できません");
      const ticket = await new OAuth2Client().verifyIdToken({
        idToken: token,
        audience: config.googleNotificationAudience,
      });
      const payload = ticket.getPayload();
      if (
        !payload?.email_verified ||
        payload.email !== config.googleNotificationEmail
      )
        fail(403, "通知の送信元を確認できません");
    },
  };
}
