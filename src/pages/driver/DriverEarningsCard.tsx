import { useDriverStats } from "@/lib/queries";

/**
 * Earnings summary shown on the driver Rides tab when there are no live
 * broadcasts. Mirrors the ride-hailing "home" dashboard: total earnings,
 * trips, credits left, expenses (subscription purchases) and profit.
 */

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
    <div className="rounded-2xl bg-gold p-3">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Total Earning" value={`₹${s.totalEarnings}`} />
        <StatTile label="Total Exp" value={`₹${s.totalExpenses}`} />
        <StatTile label="No. of Trips" value={`${s.trips}`} />
        <StatTile label="Profit" value={`₹${s.profit}`} />
        <StatTile label="Credits Left" value={`${s.creditsLeft}`} />
      </div>
    </div>
  );
}
