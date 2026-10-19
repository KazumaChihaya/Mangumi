import { useEffect, useState, useCallback } from "react";
import { api } from "../api";
export function useResource<T = any>(path?: string, interval = 5000) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const value = await api<T>(path);
      setData(value);
      setError("");
      return value;
    } catch (error) {
      setError((error as Error).message);
    }
  }, [path]);
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setData(undefined);
      return;
    }
    const load = async () => {
      try {
        const value = await api<T>(path);
        if (!cancelled) {
          setData(value);
          setError("");
        }
      } catch (error) {
        if (!cancelled) setError((error as Error).message);
      }
    };
    void load();
    const timer = interval
      ? setInterval(() => {
          if (document.visibilityState === "visible") void load();
        }, interval)
      : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [path, interval]);
  return { data, error, reload };
}
