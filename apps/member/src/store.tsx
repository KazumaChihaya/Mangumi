import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { seed, type DemoState, type Draw, selectPrize } from "./model";
import { playCue, type Cue } from "./sound";
import {
  api,
  liveMode,
  session,
  stateChanges,
  upload,
  currentArea,
} from "./api";
type Store = {
  state: DemoState;
  update: (
    fn: (draft: DemoState) => void,
    action?: string,
    target?: string,
    reason?: string,
  ) => Promise<void>;
  live: boolean;
  loading: boolean;
  connectionError: string;
  role: string;
  userId: string | null;
  refresh: () => Promise<void>;
  selectCampaign: (id: string) => Promise<void>;
  toast: string;
  notify: (text: string, cue?: Cue) => void;
  sound: boolean;
  toggleSound: () => void;
  reduced: boolean;
  toggleMotion: () => void;
  draw: (count: number) => Promise<Draw[]>;
  reset: () => void;
};
const Context = createContext<Store | null>(null);
const fresh = () => structuredClone(seed);
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(fresh);
  const ref = useRef(state);
  const [loading, setLoading] = useState(liveMode);
  const [connectionError, setConnectionError] = useState("");
  const [role, setRole] = useState("guest");
  const [userId, setUserId] = useState<string | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const campaign = useRef(
    typeof location === "undefined"
      ? "global"
      : (new URLSearchParams(location.search).get("campaign") ?? "global"),
  );
  function accept(next: DemoState) {
    const current = ref.current;
    const merged = {
      ...next,
      tipAmount: current.tipAmount,
      tipMessage: current.tipMessage,
      tipRecipient: current.tipRecipient,
      activeRoom: current.activeRoom,
      speaking: current.speaking,
      muted: current.muted,
    };
    ref.current = merged;
    setState(merged);
  }
  async function refresh() {
    if (!liveMode) return;
    try {
      await session().catch(() => undefined);
      const result = await api<{
        state: DemoState;
        role: string;
        userId: string | null;
      }>(`/state?campaign=${encodeURIComponent(campaign.current)}`);
      accept(result.state);
      setRole(result.role);
      setUserId(result.userId);
      setConnectionError("");
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "接続できませんでした",
      );
      throw error;
    } finally {
      setLoading(false);
    }
  }
  const [toast, setToast] = useState("");
  const [sound, setSound] = useState(false);
  const [reduced, setReduced] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    try {
      const saved = liveMode ? null : sessionStorage.getItem("mangumi-ui-v1");
      if (saved) {
        const next = JSON.parse(saved) as DemoState;
        if (next.profile && next.settings && next.probabilities && next.gacha) {
          ref.current = next;
          setState(next);
        }
      }
      setSound(localStorage.getItem("mangumi-sound") === "on");
      setReduced(
        localStorage.getItem("mangumi-motion") === "reduced" ||
          matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    } catch {
      /* Storage is optional. */
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!liveMode) return;
    void refresh().catch(() => {});
    const onFocus = () => {
      void pending.current.then(() => refresh()).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (typeof document !== "undefined")
      document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);
  function notify(text: string, cue: Cue = "success") {
    setToast(text);
    playCue(cue, sound);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 3400);
  }
  async function update(
    fn: (draft: DemoState) => void,
    action?: string,
    target = "設定",
    reason = "UIプレビュー操作",
  ) {
    if (liveMode) {
      const task = pending.current
        .catch(() => {})
        .then(async () => {
          const previous = ref.current;
          const draft = structuredClone(previous);
          fn(draft);
          const images = new Map<string, string>();
          async function normalize(value: any): Promise<any> {
            if (
              typeof value === "string" &&
              /^data:image\/(jpeg|png|webp);base64,/.test(value)
            ) {
              if (!images.has(value))
                images.set(
                  value,
                  (
                    await upload(
                      await (await fetch(value)).blob(),
                      currentArea() === "admin" ? "image" : "avatar",
                    )
                  ).url,
                );
              return images.get(value);
            }
            if (Array.isArray(value)) return Promise.all(value.map(normalize));
            if (value && typeof value === "object") {
              for (const key of Object.keys(value))
                value[key] = await normalize(value[key]);
            }
            return value;
          }
          await normalize(draft);
          const changes = stateChanges(previous, draft);
          if (!changes.length) {
            ref.current = draft;
            setState(draft);
            return;
          }
          const result = await api<{ state: DemoState }>(
            `/commands?campaign=${encodeURIComponent(campaign.current)}`,
            {
              changes,
              action: action ?? "利用者設定変更",
              reason:
                reason === "UIプレビュー操作" ? "利用者による操作" : reason,
            },
            "POST",
            undefined,
            crypto.randomUUID(),
          );
          accept(result.state);
        });
      pending.current = task;
      return task;
    }
    const previous = ref.current;
    const draft = structuredClone(previous);
    fn(draft);
    if (action) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of Object.keys(draft) as (keyof DemoState)[])
        if (
          key !== "audit" &&
          JSON.stringify(previous[key]) !== JSON.stringify(draft[key])
        ) {
          before[key] = previous[key];
          after[key] = draft[key];
        }
      draft.audit.unshift({
        id: crypto.randomUUID(),
        action,
        target,
        before: JSON.stringify(before),
        after: JSON.stringify(after),
        reason,
        at: new Date().toISOString(),
      });
    }
    ref.current = draft;
    setState(draft);
    try {
      sessionStorage.setItem("mangumi-ui-v1", JSON.stringify(draft));
    } catch {
      /* Session can continue without persistence. */
    }
  }
  async function draw(count: number) {
    if (liveMode) {
      const response = await api<{ results: Draw[]; balance: number }>(
        "/gacha/draw",
        { count, campaignId: campaign.current },
        "POST",
        "member",
        crypto.randomUUID(),
      );
      await refresh();
      return response.results;
    }
    const current = ref.current;
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 10 ||
      current.tickets < count
    )
      throw new Error("チケットが足りません");
    const results = Array.from({ length: count }, () => {
      const random = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
      const prize = selectPrize(current.probabilities, random);
      return {
        id: crypto.randomUUID(),
        title: prize.title,
        rarity: prize.rarity,
        image: prize.image,
        at: new Date().toISOString(),
        version: current.probabilityVersion,
      };
    });
    await update(
      (draft) => {
        draft.tickets -= count;
        draft.draws.unshift(...results);
      },
      "無料チケット抽選",
      current.gacha.title,
    );
    return results;
  }
  const value: Store = {
    live: liveMode,
    loading,
    connectionError,
    role,
    userId,
    refresh,
    selectCampaign: async (id) => {
      campaign.current = id;
      await refresh();
    },
    state,
    update,
    toast,
    notify,
    sound,
    reduced,
    draw,
    toggleSound: () => {
      const next = !sound;
      setSound(next);
      try {
        localStorage.setItem("mangumi-sound", next ? "on" : "off");
      } catch {}
      playCue("notify", next);
    },
    toggleMotion: () => {
      const next = !reduced;
      setReduced(next);
      try {
        localStorage.setItem("mangumi-motion", next ? "reduced" : "full");
      } catch {}
    },
    reset: () => {
      const next = fresh();
      ref.current = next;
      setState(next);
      try {
        sessionStorage.removeItem("mangumi-ui-v1");
      } catch {}
      notify("プレビューを初期状態に戻しました");
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useStore() {
  const store = useContext(Context);
  if (!store) throw new Error("StoreProvider is required");
  return store;
}
