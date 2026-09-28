import { useDriverStats } from "@/lib/queries";
import { Phone, MessageSquare, Send } from "lucide-react";

/**
 * Earnings summary shown on the driver Rides tab when there are no live
 * broadcasts. Mirrors the ride-hailing "home" dashboard: total earnings,
 * trips, credits left, expenses (subscription purchases) and profit.
 */
const SUPPORT_PHONE = "+919364102992";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/95 px-4 py-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-foreground">{value}</div>
    </div>
  );
}

export function DriverEarningsCard() {
  const { data } = useDriverStats();
  const s = data ?? { totalEarnings: 0, trips: 0, creditsLeft: 0, totalExpenses: 0, profit: 0 };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-emerald-700 p-3">
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Total Earning" value={`₹${s.totalEarnings}`} />
          <StatTile label="Total Exp" value={`₹${s.totalExpenses}`} />
          <StatTile label="No. of Trips" value={`${s.trips}`} />
          <StatTile label="Profit" value={`₹${s.profit}`} />
        </div>
        <div className="mt-3">
          <StatTile label="Credits Left" value={`${s.creditsLeft}`} />
        </div>
      </div>

      {/* Support footer */}
      <div className="rounded-xl border bg-muted/40 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Need help?</div>
          <div className="text-sm font-semibold">Reach us @ {SUPPORT_PHONE}</div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`tel:${SUPPORT_PHONE}`}
            className="h-9 w-9 rounded-full bg-background border flex items-center justify-center text-muted-foreground"
            aria-label="Call support"
          >
            <Phone className="h-4 w-4" />
          </a>
          <a
            href={`sms:${SUPPORT_PHONE}`}
            className="h-9 w-9 rounded-full bg-background border flex items-center justify-center text-emerald-600"
            aria-label="Message support"
          >
            <MessageSquare className="h-4 w-4" />
          </a>
          <a
            href={`https://t.me/`}
            target="_blank"
            rel="noreferrer"
            className="h-9 w-9 rounded-full bg-background border flex items-center justify-center text-sky-500"
            aria-label="Telegram support"
          >
            <Send className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
