import { useSyncExternalStore } from "react";

/**
 * Connection state of the driver's ride-alert socket (useDriverBroadcastSocket).
 *
 * New rides reach an online driver instantly over the socket (`ride:broadcast`)
 * and by FCM push, so the offers list only needs a slow safety-net poll while
 * the socket is up. While an online driver's socket is DOWN (network blip,
 * server restart, reconnect backoff) the app polls offers fast again, so a
 * broadcast is never left waiting for the slow poll.
 *
 * - "off":          driver is offline; no socket and no offers to receive
 * - "connected":    socket up; broadcasts arrive instantly
 * - "disconnected": driver online but socket down; poll fast
 */
export type DriverSocketState = "off" | "connected" | "disconnected";

// While the socket is up there is no timed offers poll: a new ride arrives over
// the socket and by FCM, and offers are refetched on (re)connect and when the
// app comes to the front. A ride only lives 60 s, so a slow poll would rarely
// catch a missed one anyway.
export const OFFERS_POLL_DISCONNECTED_MS = 8_000;

let state: DriverSocketState = "off";
// Driver has work in hand: a ride in progress, a ride assigned for now / the
// next 2 hours, or a held rental. Set by DriverShell from the rides and rentals
// it already loads. A driver can go offline mid-ride, so this keeps their trip
// screens live even then.
let busy = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setDriverSocketState(next: DriverSocketState): void {
  if (next === state) return;
  state = next;
  notify();
}

export function setDriverBusy(next: boolean): void {
  if (next === busy) return;
  busy = next;
  notify();
}

/**
 * Offline with no work in hand. The app makes NO background requests then:
 * no polling, no socket, no GPS. Screens still load when opened, on app focus,
 * and after the driver's own actions; account notices still arrive by push.
 */
export function isDriverDormant(s: DriverSocketState, isBusy: boolean): boolean {
  return s === "off" && !isBusy;
}

const getDormant = () => isDriverDormant(state, busy);

export function useDriverDormant(): boolean {
  return useSyncExternalStore(subscribe, getDormant, getDormant);
}

/** Poll interval for a driver query: `ms` normally, never while dormant. */
export function driverPollInterval(ms: number, dormant: boolean): number | false {
  return dormant ? false : ms;
}

/** Hook form of driverPollInterval for use inside query hooks. */
export function useDriverPoll(ms: number): number | false {
  return driverPollInterval(ms, useDriverDormant());
}

/** True when a ride counts as work in hand (keeps the app out of dormant mode). */
export function rideKeepsDriverBusy(
  r: { status: string; scheduledFor?: string | null },
  now = Date.now(),
): boolean {
  if (r.status === "in_progress") return true;
  if (r.status !== "assigned") return false;
  if (!r.scheduledFor) return true;
  // A claimed scheduled ride for tomorrow is not work in hand; reminder pushes
  // (24h / 2h / 45min) cover it until it gets close.
  return new Date(r.scheduledFor).getTime() - now <= 2 * 60 * 60 * 1000;
}

export function getDriverSocketState(): DriverSocketState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDriverSocketState(): DriverSocketState {
  return useSyncExternalStore(subscribe, getDriverSocketState, getDriverSocketState);
}

/** Offers poll: every 8 s only while an online driver's socket is down; otherwise none. */
export function offersPollInterval(s: DriverSocketState): number | false {
  return s === "disconnected" ? OFFERS_POLL_DISCONNECTED_MS : false;
}