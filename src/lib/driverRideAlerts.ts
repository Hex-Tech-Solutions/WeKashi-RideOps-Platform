import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { tokenStore } from "@/lib/api";

export interface DriverBroadcastPayload {
  id?: string;
  type?: string;
  pickup_address?: string;
  drop_address?: string;
  price?: number | null;
  broadcast_expires_at?: string | null;
}

function playRideAlertSound(): void {
  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(660, context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.45);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Browser autoplay policies may prevent audio; vibration/visual alert still work.
  }
}

export function alertDriverOfBroadcast(): void {
  if ("vibrate" in navigator) navigator.vibrate([220, 100, 220]);
  playRideAlertSound();
}

/**
 * One authenticated driver socket for the whole DriverShell. Polling remains
 * enabled as a reconciliation fallback for reconnects and missed events.
 */
export function useDriverBroadcastSocket(
  enabled: boolean,
  onBroadcast: (payload: DriverBroadcastPayload) => void,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !tokenStore.access) return undefined;

    const socket: Socket = io("/driver", {
      auth: { token: tokenStore.access },
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    const handleBroadcast = (payload: DriverBroadcastPayload) => {
      // The server has already persisted the RideOffer before emitting. Refetch
      // the same complete offer model used by the normal UI, rather than trusting
      // a partial socket payload for acceptability/expiry decisions.
      void queryClient.invalidateQueries({ queryKey: ["driver", "offers"] });
      onBroadcast(payload);
      alertDriverOfBroadcast();
    };

    socket.on("ride:broadcast", handleBroadcast);
    return () => {
      socket.off("ride:broadcast", handleBroadcast);
      socket.disconnect();
    };
  }, [enabled, onBroadcast, queryClient]);
}
