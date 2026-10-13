import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { seed, type DemoState, type Draw, selectPrize } from "./model";
import { playCue, type Cue } from "./sound";
type Store = {
  state: DemoState;
  update: (
    fn: (draft: DemoState) => void,
    action?: string,
    target?: string,
    reason?: string,
  ) => void;
  toast: string;
  notify: (text: string, cue?: Cue) => void;
  sound: boolean;
  toggleSound: () => void;
  reduced: boolean;
  toggleMotion: () => void;
  draw: (count: number) => Draw[];
  reset: () => void;
};
const Context = createContext<Store | null>(null);
const fresh = () => structuredClone(seed);
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(fresh);
  const ref = useRef(state);
  const [toast, setToast] = useState("");
  const [sound, setSound] = useState(false);
  const [reduced, setReduced] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("mangumi-ui-v1");
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
    if (typeof document !== "undefined")
      document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);
  function notify(text: string, cue: Cue = "success") {
    setToast(text);
    playCue(cue, sound);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 3400);
  }
  function update(
    fn: (draft: DemoState) => void,
    action?: string,
    target = "設定",
    reason = "UIプレビュー操作",
  ) {
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
  function draw(count: number) {
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
    update(
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
