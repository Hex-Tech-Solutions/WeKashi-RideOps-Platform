import { useState } from "react";
import { PageHeader, StatCard } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRides, useOtdReport, type OtdReportRow } from "@/lib/queries";
import { statusColor } from "@/lib/rideStatus";
import { formatDistanceToNow } from "date-fns";
import { Download, Loader2, FileSpreadsheet, TrendingUp, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

function delayCauseColor(cause: string) {
  if (cause === "Early")   return "border-success/40 text-success bg-success/5";
  if (cause === "On Time") return "border-success/40 text-success bg-success/5";
  if (cause === "Employee") return "border-warning/40 text-warning bg-warning/5";
  if (cause === "Driver")   return "border-destructive/40 text-destructive bg-destructive/5";
  return "border-border text-muted-foreground";
}

// ── CSV export ─────────────────────────────────────────────────────────────────

function exportCsv(rows: OtdReportRow[], from: string, to: string) {
  const headers = [
    "S.No", "Facility", "Office", "Date", "Trip Type / Shift Time", "Trip Id",
    "Vehicle Id", "Registration No.", "Vendor",
    "Planned Employee Count", "Travelled Employee Count",
    "First Employee Signin", "Last Employee Signin",
    "Trip Start Early / Delay (min)", "Trip KM", "Delay Cause",
    "Planned Start Time", "Logout Grace Time (Secs)", "Target Time (L+M)",
    "Actual Start Time", "Driver Reporting Time",
    "Planned Start Time", "Last Employee name/ID", "Last Employee Signin Time", "Planned Start Time",
  ];
  const csvRows = rows.map((r) => [
    r.sNo, r.facility, r.office, r.date, r.tripTypeShiftTime, r.tripId,
    r.vehicleId, r.registrationNo, r.vendor,
    r.plannedEmployeeCount, r.travelledEmployeeCount,
    r.firstEmployeeSignin, r.lastEmployeeSignin,
    r.tripStartDelayMin ?? "", r.tripKm ?? "", r.delayCause,
    r.plannedStartTime, r.logoutGraceTimeSecs, r.targetTime,
    r.actualStartTime, r.driverReportingTime,
    r.plannedStartTime, r.lastEmployeeName, r.lastEmployeeSigninTime, r.plannedStartTime,
  ]);

  const csv = [headers, ...csvRows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `OTD_Report_${from}_to_${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Reports() {
  const { data } = useRides({ limit: 200 });
  const rides = data?.rides ?? [];
  const completed = rides.filter((r) => r.status === "completed");
  const spend = completed.reduce((s, r) => s + (r.price ?? 0), 0);
  const avg = completed.length ? Math.round(spend / completed.length) : 0;
  const byStatus = rides.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});

  const [from, setFrom] = useState(daysAgoStr(7));
  const [to,   setTo]   = useState(todayStr());
  const [fetch, setFetch] = useState(false);

  const { data: otdData, isLoading: otdLoading, isError: otdError } = useOtdReport(from, to, fetch);
  const otdRows = otdData?.rows ?? [];

  // OTD summary stats
  const onTime    = otdRows.filter((r) => r.delayCause === "Early" || r.delayCause === "On Time").length;
  const late      = otdRows.filter((r) => r.delayCause === "Employee" || r.delayCause === "Driver").length;
  const otdPct    = otdRows.length ? Math.round((onTime / otdRows.length) * 100) : 0;
  const avgDelay  = otdRows.length
    ? Math.round(otdRows.reduce((s, r) => s + (r.tripStartDelayMin ?? 0), 0) / otdRows.length)
    : 0;

  return (
    <div>
      <PageHeader title="Reports" description="Operational insights and OTD analysis." />

      <Tabs defaultValue="summary">
        <TabsList className="mb-6">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="otd">OTD Report</TabsTrigger>
        </TabsList>

        {/* ── Summary tab ─────────────────────────────────────────────────── */}
        <TabsContent value="summary">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total rides" value={rides.length} />
            <StatCard label="Completed" value={completed.length} accent />
            <StatCard label="Spend · completed" value={`₹${(spend / 1000).toFixed(1)}k`} />
            <StatCard label="Avg cost / ride" value={`₹${avg}`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="text-base">Rides by status</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.keys(byStatus).length === 0 && <div className="text-sm text-muted-foreground text-center py-8">No rides yet.</div>}
                {Object.entries(byStatus).map(([status, n]) => (
                  <div key={status} className="flex items-center justify-between p-3 rounded border text-sm">
                    <Badge variant="outline" className={statusColor(status)}>{status.replace("_", " ")}</Badge>
                    <span className="font-medium">{n}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader><CardTitle className="text-base">Recent rides</CardTitle></CardHeader>
              <CardContent className="space-y-2 max-h-80 overflow-auto">
                {rides.length === 0 && <div className="text-sm text-muted-foreground text-center py-8">No rides yet.</div>}
                {rides.slice(0, 12).map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-2.5 rounded border text-xs">
                    <div>
                      <span className="font-mono">{r.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground ml-2">{r.pickupAddress} → {r.dropAddress}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span>
                      <span className="font-semibold">{r.price != null ? `₹${r.price}` : "—"}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── OTD Report tab ───────────────────────────────────────────────── */}
        <TabsContent value="otd">
          <Card className="shadow-card mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-gold" />
                On-Time Delivery (OTD) Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-40" max={to} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-40" min={from} max={todayStr()} />
                </div>
                <div className="flex gap-2">
                  <Button
                    className="bg-foreground text-background hover:bg-foreground/90"
                    onClick={() => setFetch(true)}
                    disabled={otdLoading}
                  >
                    {otdLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</> : "Generate report"}
                  </Button>
                  {otdRows.length > 0 && (
                    <Button variant="outline" onClick={() => exportCsv(otdRows, from, to)}>
                      <Download className="h-4 w-4" /> Export CSV
                    </Button>
                  )}
                </div>
              </div>

              {otdError && (
                <div className="mt-4 text-sm text-destructive">Failed to load report. Try again.</div>
              )}
            </CardContent>
          </Card>

          {/* OTD KPI strip */}
          {otdRows.length > 0 && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <StatCard label="Total trips" value={otdRows.length} />
                <StatCard label="On-time / Early" value={onTime} accent />
                <StatCard label="OTD %" value={`${otdPct}%`} />
                <StatCard label="Avg delay (min)" value={avgDelay > 0 ? `+${avgDelay}` : avgDelay === 0 ? "0" : `${avgDelay}`} />
              </div>

              {/* OTD Table */}
              <Card className="shadow-card">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-sm">{otdRows.length} trips · {from} to {to}</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => exportCsv(otdRows, from, to)}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="w-full">
                    <div className="min-w-[1100px]">
                      {/* Table header */}
                      <div className="grid grid-cols-[40px_80px_140px_90px_130px_80px_160px_90px_60px_60px_70px_70px_70px_70px_80px_100px] gap-0 border-b bg-muted/40 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        {["#","Date","Office","Shift","Trip ID","Vendor","Vehicle","Reg No.","Plan","Actual","Driver","1st In","Last In","Delay","KM","Cause"].map((h) => (
                          <div key={h} className="px-2 py-2 truncate">{h}</div>
                        ))}
                      </div>
                      {/* Table rows */}
                      {otdRows.map((r) => (
                        <div
                          key={r.sNo}
                          className="grid grid-cols-[40px_80px_140px_90px_130px_80px_160px_90px_60px_60px_70px_70px_70px_70px_80px_100px] gap-0 border-b text-xs hover:bg-muted/20 transition-colors"
                        >
                          <div className="px-2 py-2 text-muted-foreground">{r.sNo}</div>
                          <div className="px-2 py-2 font-mono text-[10px]">{r.date}</div>
                          <div className="px-2 py-2 truncate" title={r.office}>{r.office}</div>
                          <div className="px-2 py-2 truncate text-[10px]">{r.tripTypeShiftTime}</div>
                          <div className="px-2 py-2 font-mono text-[10px]">{r.tripId}</div>
                          <div className="px-2 py-2 truncate text-[10px]" title={r.vendor}>{r.vendor}</div>
                          <div className="px-2 py-2 truncate text-[10px]" title={r.vehicleId}>{r.vehicleId}</div>
                          <div className="px-2 py-2 font-mono text-[10px]">{r.registrationNo}</div>
                          <div className="px-2 py-2 font-mono font-semibold">{r.plannedStartTime || "—"}</div>
                          <div className="px-2 py-2 font-mono">{r.actualStartTime || "—"}</div>
                          <div className="px-2 py-2 font-mono text-muted-foreground">{r.driverReportingTime || "—"}</div>
                          <div className="px-2 py-2 font-mono">{r.firstEmployeeSignin || "—"}</div>
                          <div className="px-2 py-2 font-mono">{r.lastEmployeeSignin || "—"}</div>
                          <div className={`px-2 py-2 font-semibold ${
                            r.tripStartDelayMin == null ? "text-muted-foreground"
                            : r.tripStartDelayMin <= 0 ? "text-success"
                            : r.tripStartDelayMin <= 5 ? "text-warning"
                            : "text-destructive"
                          }`}>
                            {r.tripStartDelayMin == null ? "—" : r.tripStartDelayMin > 0 ? `+${r.tripStartDelayMin}` : r.tripStartDelayMin}
                          </div>
                          <div className="px-2 py-2 text-muted-foreground">{r.tripKm ?? "—"}</div>
                          <div className="px-2 py-2">
                            {r.delayCause ? (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${delayCauseColor(r.delayCause)}`}>
                                {r.delayCause}
                              </span>
                            ) : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Delay breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                {[
                  { label: "Early / On Time", count: onTime, icon: <CheckCircle2 className="h-4 w-4 text-success" />, cls: "border-success/30 bg-success/5" },
                  { label: "Employee delay", count: otdRows.filter((r) => r.delayCause === "Employee").length, icon: <AlertTriangle className="h-4 w-4 text-warning" />, cls: "border-warning/30 bg-warning/5" },
                  { label: "Driver delay", count: otdRows.filter((r) => r.delayCause === "Driver").length, icon: <Clock className="h-4 w-4 text-destructive" />, cls: "border-destructive/30 bg-destructive/5" },
                ].map((b) => (
                  <Card key={b.label} className={`shadow-card border ${b.cls}`}>
                    <CardContent className="p-4 flex items-center gap-3">
                      {b.icon}
                      <div>
                        <div className="text-2xl font-bold">{b.count}</div>
                        <div className="text-xs text-muted-foreground">{b.label}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          {fetch && !otdLoading && otdRows.length === 0 && !otdError && (
            <Card className="shadow-card">
              <CardContent className="py-16 text-center">
                <TrendingUp className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
                <div className="font-medium text-sm">No completed rides in this date range</div>
                <div className="text-xs text-muted-foreground mt-1">
                  OTD data appears once rides are completed with planned start times set.
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
