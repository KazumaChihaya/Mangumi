import React, { useEffect, useState } from "react";
import { publicPath } from "../web-path";
import { Button, Icon, Panel } from "../ui";
import { useResource } from "./hooks";

export function LivePwa({ admin = false }: { admin?: boolean }) {
  const [guide, setGuide] = useState(false);
  const [device, setDevice] = useState("PC");
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [install, setInstall] = useState<any>(null);
  const brand = useResource("/brand", 0);
  useEffect(() => {
    const standalone =
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone;
    const ios =
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setDevice(
      ios
        ? "iPhone / iPad"
        : /Android/.test(navigator.userAgent)
          ? "Android"
          : "PC",
    );
    try {
      setGuide(
        !admin && !standalone && !localStorage.getItem("mangumi-install-guide"),
      );
    } catch {}
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event);
    };
    const installed = () => {
      setGuide(false);
      setInstall(null);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", installed);
    let stopped = false;
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register(publicPath("/sw.js"))
        .then((registration) => {
          if (stopped) return;
          if (registration.waiting) setWaiting(registration.waiting);
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
              if (
                !stopped &&
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setWaiting(worker);
            });
          });
        })
        .catch(() => {});
    return () => {
      stopped = true;
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, [admin]);
  const dismiss = () => {
    setGuide(false);
    try {
      localStorage.setItem("mangumi-install-guide", "seen");
    } catch {}
  };
  return (
    <>
      {waiting && (
        <Panel title="新しいバージョンを利用できます">
          <p>入力中の内容を保存してから更新してください。</p>
          <Button
            onClick={() => {
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => window.location.reload(),
                { once: true },
              );
              waiting.postMessage({ type: "SKIP_WAITING" });
            }}
          >
            アプリを更新
          </Button>
        </Panel>
      )}
      {guide && (
        <Panel title={`${device}のホーム画面に追加`}>
          {brand.data?.installGuide && (
            <img
              src={brand.data.installGuide}
              alt="ホーム画面への追加手順"
              style={{ width: "100%", height: "auto", objectFit: "contain" }}
            />
          )}
          <div className="install-illustration" aria-hidden="true">
            <div className="install-phone">
              <Icon name="heart" size={30} />
            </div>
            <Icon name="chevron" />
            <div className="install-phone">
              <Icon name="download" size={30} />
            </div>
          </div>
          <ol className="step-list">
            {(device === "iPhone / iPad"
              ? [
                  "Safariでこのページを開く",
                  "共有メニューから「ホーム画面に追加」を選ぶ",
                  "追加したアイコンから起動する",
                ]
              : device === "Android"
                ? [
                    "Chromeでこのページを開く",
                    "メニューから「アプリをインストール」を選ぶ",
                    "ホーム画面のアイコンから起動する",
                  ]
                : [
                    "ChromeまたはEdgeでこのページを開く",
                    "アドレスバーのインストールアイコンを選ぶ",
                    "アプリ一覧から起動する",
                  ]
            ).map((step) => (
              <li key={step}>
                <strong>{step}</strong>
              </li>
            ))}
          </ol>
          {install && (
            <Button
              onClick={async () => {
                await install.prompt();
                const result = await install.userChoice;
                if (result.outcome === "accepted") dismiss();
              }}
            >
              インストールする
            </Button>
          )}
          <Button tone="ghost" onClick={dismiss}>
            ブラウザで続ける
          </Button>
        </Panel>
      )}
    </>
  );
}
