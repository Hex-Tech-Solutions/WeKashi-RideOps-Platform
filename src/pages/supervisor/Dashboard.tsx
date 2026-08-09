import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSupervisorDashboard, useLiveOps, type LiveOpsTile } from "@/lib/queries";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Plus, ArrowRight, Radio, Clock, Users, IndianRupee,
  TrendingUp, AlertTriangle, CheckCircle2, Loader2,
  CalendarCheck, ShieldAlert, Car, Target, UserRound, RefreshCw,
} from "lucide-react";

// ─── Colour palette ───────────────────────────────────────────────────────────
const GOLD   = "hsl(46 65% 52%)";
const GREEN  = "hsl(142 76% 36%)";
const WARN   = "hsl(38 92% 50%)";
const RED    = "hsl(0 84% 60%)";
const MUTED  = "hsl(215 20% 65%)";

const DELAY_COLORS: Record<string, string> = {
  early:    GREEN,
  onTime:   GOLD,
  employee: WARN,
  driver:   RED,
};
const DELAY_LABELS: Record<string, string> = {
  early: "Early",
  onTime: "On Time",
  employee: "Employee Delay",
  driver: "Driver Delay",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const shortDate = (d: string) => {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
};

// ─── Main component ───────────────────────────────────────────────────────────
export default function SupervisorDashboard() {
  const { profile } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];
  const { data, isLoading } = useSupervisorDashboard();
  const { data: liveOps, dataUpdatedAt } = useLiveOps();

  const kpis    = data?.kpis;
  const trend   = data?.otdTrend   ?? [];
  const delay   = data?.delayCounts;
  const volume  = data?.volumeTrend ?? [];
  const issues  = data?.recentIssues ?? [];

  // Pie data for delay breakdown
  const pieData = delay
    ? Object.entries(delay)
        .filter(([k]) => k !== "noData")
        .map(([k, v]) => ({ name: DELAY_LABELS[k] ?? k, value: v as number, key: k }))
        .filter((d) => d.value > 0)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Live operations overview for your team."
        actions={
          <Button asChild className="bg-foreground text-background hover:bg-foreground/90">
            <Link to="/supervisor/routes"><Plus className="h-4 w-4" /> New booking</Link>
          </Button>
        }
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading dashboard…
        </div>
      )}

      {/* ── Live Ops Board — always shown, updates every 15s ──────────────── */}
      {liveOps && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              Live operations · last 24 h
            </div>
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "…"}
            </div>
          </div>

          {/* Row 1 — full width: Trips Generated */}
          <OpsTile
            label="Trips Generated"
            count={liveOps.generated.count}
            tile={liveOps.generated}
            to="/supervisor/live"
            color="neutral"
            className="mb-3"
          />

          {/* Row 2 — two columns */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <OpsTile
              label="Yet to Start"
              count={liveOps.yetToStart.count}
              tile={liveOps.yetToStart}
              to="/supervisor/live"
              color="neutral"
            />
            <OpsTile
              label="Trips not downloaded"
              count={liveOps.notDownloaded.count}
              tile={liveOps.notDownloaded}
              to="/supervisor/live"
              color="neutral"
            />
          </div>

          {/* Row 3 — two columns */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <OpsTile
              label="On Time Trips"
              count={liveOps.onTime.count}
              tile={liveOps.onTime}
              to="/supervisor/live"
              color="success"
              extra={liveOps.onTime.onTimePickupPct != null
                ? `On Time Pickup: ${liveOps.onTime.onTimePickupPct}%`
                : undefined}
            />
            <OpsTile
              label="Ongoing Delayed Trips"
              count={liveOps.delayed.count}
              tile={liveOps.delayed}
              to="/supervisor/live"
              color={liveOps.delayed.count > 0 ? "danger" : "neutral"}
            />
          </div>

          {/* Row 4 — full width: Completed on Time */}
          <OpsTile
            label="Completed on Time"
            count={liveOps.completedOnTime.count}
            tile={liveOps.completedOnTime}
            to="/supervisor/live"
            color="success-soft"
            extra={liveOps.completedOnTime.otaPct != null
              ? `OTA: ${liveOps.completedOnTime.otaPct}%`
              : undefined}
          />
        </div>
      )}

      {!isLoading && kpis && (
        <>
          {/* ── KPI strip ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              label="Today's rides"
              value={kpis.ridesToday}
              icon={<CalendarCheck className="h-4 w-4" />}
              hint="Excl. cancelled"
            />
            <KpiCard
              label="Active now"
              value={kpis.activeRides}
              icon={<Car className="h-4 w-4" />}
              accent={kpis.activeRides > 0}
              hint={kpis.broadcastingRides > 0 ? `${kpis.broadcastingRides} broadcasting` : "No active broadcasts"}
            />
            <KpiCard
              label="This month"
              value={kpis.completedThisMonth}
              icon={<CheckCircle2 className="h-4 w-4" />}
              hint="Completed rides"
            />
            <KpiCard
              label="OTD this month"
              value={kpis.otdPct != null ? `${kpis.otdPct}%` : "—"}
              icon={<Target className="h-4 w-4" />}
              accent={kpis.otdPct != null && kpis.otdPct >= 80}
              warn={kpis.otdPct != null && kpis.otdPct < 80}
              hint="On-time delivery"
            />
            <KpiCard
              label="Spend today"
              value={`₹${fmt(kpis.spendToday)}`}
              icon={<IndianRupee className="h-4 w-4" />}
              hint={`₹${fmt(kpis.spendMonth)} this month`}
            />
            <KpiCard
              label="Open issues"
              value={kpis.openIssues}
              icon={<AlertTriangle className="h-4 w-4" />}
              warn={kpis.openIssues > 0}
              hint={kpis.sosThisMonth > 0 ? `${kpis.sosThisMonth} SOS this month` : "No SOS this month"}
            />
          </div>

          {/* ── Employee coverage ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="shadow-card col-span-1">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Employee coverage · this week
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  <div className="text-4xl font-bold">{kpis.coveragePct}%</div>
                  <div className="text-sm text-muted-foreground mb-1">
                    {kpis.employeesCoveredThisWeek} / {kpis.totalEmployees} employees
                  </div>
                </div>
                {/* Coverage bar */}
                <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gold transition-all"
                    style={{ width: `${kpis.coveragePct}%` }}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  Unique employees who rode at least once this week
                </div>
              </CardContent>
            </Card>

            {/* Delay donut */}
            <Card className="shadow-card col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gold" /> Delay breakdown · 30 days
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-4">
                {pieData.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-8">
                    No completed rides with planned times yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.key} fill={DELAY_COLORS[entry.key] ?? MUTED} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number, name: string) => [`${v} trips`, name]}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Quick actions */}
            <Card className="shadow-card col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Quick actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: "Book a ride",    to: "/supervisor/routes",  dot: kpis.broadcastingRides > 0 ? "gold" : null },
                  { label: "Live rides",     to: "/supervisor/live",    dot: kpis.activeRides > 0 ? "success" : null },
                  { label: "View issues",    to: "/supervisor/issues",  dot: kpis.openIssues > 0 ? "destructive" : null },
                  { label: "OTD report",     to: "/supervisor/reports", dot: null },
                  { label: "Manage roster",  to: "/supervisor/roster",  dot: null },
                ].map((a) => (
                  <Button key={a.to} asChild variant="outline" size="sm" className="w-full justify-between">
                    <Link to={a.to}>
                      <span className="flex items-center gap-2">
                        {a.dot && (
                          <span className={`h-2 w-2 rounded-full bg-${a.dot} animate-pulse shrink-0`} />
                        )}
                        {a.label}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* ── OTD trend + volume trend ───────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* OTD trend line */}
            <Card className="shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-gold" /> OTD % · last 30 days
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trend.length < 2 ? (
                  <div className="text-xs text-muted-foreground text-center py-12">
                    Not enough data yet — complete rides with planned start times to see this chart.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="otdGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={GOLD} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        formatter={(v: number) => [`${v}%`, "OTD"]}
                        labelFormatter={(l) => shortDate(l)}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Area type="monotone" dataKey="otdPct" stroke={GOLD} strokeWidth={2} fill="url(#otdGrad)" dot={false} activeDot={{ r: 4 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Ride volume stacked bar */}
            <Card className="shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-gold" /> Ride volume · last 14 days
                </CardTitle>
              </CardHeader>
              <CardContent>
                {volume.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-12">
                    No ride data for the last 14 days.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={volume} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barSize={14}>
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        labelFormatter={(l) => shortDate(l)}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="login"  name="Login"  stackId="a" fill={GOLD}  radius={[0, 0, 3, 3]} />
                      <Bar dataKey="logout" name="Logout" stackId="a" fill={MUTED} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Issues strip ──────────────────────────────────────────────── */}
          {issues.length > 0 && (
            <Card className="shadow-card border-destructive/20">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                  <ShieldAlert className="h-4 w-4" /> Open issues ({kpis.openIssues})
                </CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/supervisor/issues">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                      issue.isSos
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border bg-card"
                    }`}
                  >
                    {issue.isSos
                      ? <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      : <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {issue.isSos && (
                          <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px] py-0">SOS</Badge>
                        )}
                        <span className="font-medium capitalize">
                          {issue.issueType?.replace("_", " ") ?? "Issue"}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{issue.driver?.fullName ?? "Unknown driver"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{issue.description}</div>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon, hint, accent, warn,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  hint?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <Card className={`shadow-card ${accent ? "border-gold/50 bg-gold/5" : warn ? "border-warning/50 bg-warning/5" : ""}`}>
      <CardContent className="p-4">
        <div className={`flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold mb-2 ${
          accent ? "text-gold-dark" : warn ? "text-warning" : "text-muted-foreground"
        }`}>
          {icon}
          {label}
        </div>
        <div className="text-2xl font-bold leading-none">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-1.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Ops tile ─────────────────────────────────────────────────────────────────

const COLOR_MAP = {
  neutral:      "bg-secondary border-border",
  success:      "bg-success/10 border-success/30",
  "success-soft": "bg-success/5 border-success/20",
  danger:       "bg-destructive/10 border-destructive/30",
};

const LABEL_MAP = {
  neutral:      "text-foreground",
  success:      "text-success",
  "success-soft": "text-success",
  danger:       "text-destructive",
};

const COUNT_MAP = {
  neutral:      "text-foreground",
  success:      "text-success",
  "success-soft": "text-success",
  danger:       "text-destructive",
};

function OpsTile({
  label,
  count,
  tile,
  to,
  color,
  extra,
  className = "",
}: {
  label: string;
  count: number;
  tile: LiveOpsTile;
  to: string;
  color: keyof typeof COLOR_MAP;
  extra?: string;
  className?: string;
}) {
  return (
    <Link to={to} className={`block rounded-xl border p-4 transition-opacity hover:opacity-90 ${COLOR_MAP[color]} ${className}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-semibold ${LABEL_MAP[color]}`}>{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-2xl font-bold leading-none ${COUNT_MAP[color]}`}>{count}</span>
          <ArrowRight className={`h-4 w-4 ${COUNT_MAP[color]}`} />
        </div>
      </div>

      {/* Employee breakdown */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {/* Total */}
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Users className="h-3.5 w-3.5" />
          {tile.total}
        </span>
        <span className="text-muted-foreground/40">|</span>
        {/* Female */}
        <span className="flex items-center gap-1 text-pink-600 font-medium">
          <UserRound className="h-3.5 w-3.5" />
          {tile.female}
        </span>
        <span className="text-muted-foreground/40">|</span>
        {/* Male */}
        <span className="flex items-center gap-1 text-blue-600 font-medium">
          <UserRound className="h-3.5 w-3.5" />
          {tile.male}
        </span>
        {/* Extra metric (OTP%, OTA%) */}
        {extra && (
          <>
            <span className="text-muted-foreground/40 ml-auto">|</span>
            <span className={`font-semibold ml-1 ${COUNT_MAP[color]}`}>{extra}</span>
          </>
        )}
      </div>
    </Link>
  );
}
