import { useEffect, useRef } from "react";

/**
 * Tracks whether the current browser tab is visible (foregrounded).
 * Used to pause polling/live-tracking API calls when the supervisor has
 * navigated to a different tab — the component is still mounted (timers
 * would otherwise keep firing), but nobody is actually looking at it.
 *
 * Returns a ref (not state) so callers can read the latest value inside a
 * setInterval/setTimeout callback without needing to re-create the timer
 * every time visibility changes.
 */
export function usePageVisibleRef() {
  const visibleRef = useRef(typeof document === "undefined" ? true : document.visibilityState === "visible");

  useEffect(() => {
    const handler = () => { visibleRef.current = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return visibleRef;
}
