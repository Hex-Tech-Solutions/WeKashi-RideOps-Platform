/**
 * Where a tapped push notice should take the driver. The server puts one of
 * these in the notice's `screen` field (backend/src/lib/fcm.ts NoticeScreen).
 *
 * The tap can arrive before the driver shell has mounted (app opened from a
 * closed state), so the request is also kept until the shell asks for it.
 */
export type NoticeScreen = "home" | "documents" | "credits" | "profile" | "scheduled" | "trips" | "sos" | "facecheck";

const SCREENS: readonly NoticeScreen[] = ["home", "documents", "credits", "profile", "scheduled", "trips", "sos", "facecheck"];
export const OPEN_SCREEN_EVENT = "wekashi:openScreen";

let pending: NoticeScreen | null = null;

export function isNoticeScreen(v: unknown): v is NoticeScreen {
  return typeof v === "string" && (SCREENS as readonly string[]).includes(v);
}

/** Called when a notice is tapped. */
export function requestScreen(screen: NoticeScreen): void {
  pending = screen;
  window.dispatchEvent(new CustomEvent<NoticeScreen>(OPEN_SCREEN_EVENT, { detail: screen }));
}

/** The shell calls this once it is mounted; returns the waiting screen (once). */
export function takePendingScreen(): NoticeScreen | null {
  const s = pending;
  pending = null;
  return s;
}
