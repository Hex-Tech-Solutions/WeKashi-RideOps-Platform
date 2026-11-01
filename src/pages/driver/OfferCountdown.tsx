import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

/**
 * Countdown to a broadcast offer's expiry (mm:ss). Turns red in the last 30s.
 * Shared by the broadcasts list (DriverHome) and the full-screen incoming-ride
 * overlay so both show the same server-driven timer.
 */
export function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const urgent = left <= 30;

  return (
    <span
      className={`flex items-center gap-1 font-mono font-semibold shrink-0 ${
        urgent ? "text-destructive animate-pulse" : "text-gold-dark"
      }`}
    >
      <Timer className="h-3.5 w-3.5" />
      {left > 0 ? `${mm}:${ss}` : "expired"}
    </span>
  );
}
