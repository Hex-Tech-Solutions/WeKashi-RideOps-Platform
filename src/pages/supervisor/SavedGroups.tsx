import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useRouteTemplates,
  useUpdateRouteTemplate,
  useDeleteRouteTemplate,
  useSavedGroupsReport,
  type RouteTemplateRow,
} from "@/lib/queries";
import { useNavigate } from "react-router-dom";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BookOpen, Trash2, Clock, Users, Car, Building2, ArrowRight,
  Download, IndianRupee, BarChart3, Play, TrendingUp,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── CSV export ───────────────────────────────────────────────────────────────
function exportCsv(rows: ReturnType<typeof useSavedGroupsReport>["data"]["report"]) {
  if (!rows?.length) return;
  const headers = [
    "Group Name", "Type", "Vehicle", "Employees", "Office",
    "Total Rides", "Completed Rides", "Total Revenue (₹)", "Avg Fare (₹)",
    "Last Used", "Created",
  ];
  const csvRows = rows.map((r) => [
    r.name, r.rideType, r.vehicleType ?? "any", r.employeeCount, r.officeName ?? "—",
    r.totalRides, r.completedRides,
    r.totalRevenue.toFixed(0), r.avgFare.toFixed(0),
    r.lastUsedAt ? format(new Date(r.lastUsedAt), "dd MMM yyyy") : "Never",
    format(new Date(r.createdAt), "dd MMM yyyy"),
  ]);
  const csv = [headers, ...csvRows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Saved_Groups_Report_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SavedGroups() {
  const nav = useNavigate();
  const { data: templatesData } = useRouteTemplates();
  const { data: reportData } = useSavedGroupsReport();
  const updateTemplate = useUpdateRouteTemplate();
  const deleteTemplate = useDeleteRouteTemplate();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const templates = templatesData?.templates ?? [];
  const report = reportData?.report ?? [];

  // Load a template into the booking flow
  const loadTemplate = (t: RouteTemplateRow) => {
    updateTemplate.mutate({ id: t.id, markUsed: true } as any, {
      onSuccess: () => {
        // Navigate to routes page — the Routes page reads templates on mount
        // Pass the template id via query param so Routes.tsx can auto-load it
        nav(`/supervisor/routes?loadGroup=${t.id}`);
      },
    });
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Saved Groups"
        description="Reusable employee groups for one-tap booking and usage analytics."
        actions={
          <Button asChild className="bg-foreground text-background hover:bg-foreground/90">
            <a href="/supervisor/routes">
              <Play className="h-4 w-4" /> Book a ride
            </a>
          </Button>
        }
      />

      <Tabs defaultValue="groups">
        <TabsList className="mb-6">
          <TabsTrigger value="groups">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            Groups ({templates.length})
          </TabsTrigger>
          <TabsTrigger value="report">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
            Usage report
          </TabsTrigger>
        </TabsList>

        {/* ── Groups list ───────────────────────────────────────────────────── */}
        <TabsContent value="groups">
          {templates.length === 0 ? (
            <Card className="shadow-card">
              <CardContent className="py-16 text-center space-y-3">
                <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/30" />
                <div className="font-medium">No saved groups yet</div>
                <div className="text-sm text-muted-foreground max-w-sm mx-auto">
                  When booking a ride, go to Step 2 and click <b>Save group</b> to save the employee selection for reuse.
                </div>
                <Button asChild variant="outline" className="mt-2">
                  <a href="/supervisor/routes">
                    <Play className="h-3.5 w-3.5" /> Start a booking
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {templates.map((t) => {
                const stats = report.find((r) => r.id === t.id);
                return (
                  <Card key={t.id} className="shadow-card flex flex-col">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm truncate">{t.name}</CardTitle>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge variant="outline" className="capitalize text-[10px] py-0">{t.rideType}</Badge>
                            {t.vehicleType && (
                              <Badge variant="outline" className="capitalize text-[10px] py-0">
                                <Car className="h-3 w-3 mr-1" />{t.vehicleType}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => setDeleteId(t.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="flex-1 space-y-3 pt-0">
                      {/* Group meta */}
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 shrink-0" />
                          {(t.orderedEmployeeIds as string[]).length} employees
                        </div>
                        {t.officeLocation && (
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 shrink-0" />
                            {t.officeLocation.name}
                          </div>
                        )}
                        {t.lastUsedAt && (
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            Last used {formatDistanceToNow(new Date(t.lastUsedAt), { addSuffix: true })}
                          </div>
                        )}
                        {!t.lastUsedAt && (
                          <div className="flex items-center gap-1.5 text-muted-foreground/60">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            Never used
                          </div>
                        )}
                      </div>

                      {/* Usage stats from report */}
                      {stats && stats.totalRides > 0 && (
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                          <div className="text-center">
                            <div className="text-base font-bold">{stats.totalRides}</div>
                            <div className="text-[10px] text-muted-foreground">Total rides</div>
                          </div>
                          <div className="text-center">
                            <div className="text-base font-bold">{stats.completedRides}</div>
                            <div className="text-[10px] text-muted-foreground">Completed</div>
                          </div>
                          <div className="text-center">
                            <div className="text-base font-bold">₹{(stats.totalRevenue / 1000).toFixed(1)}k</div>
                            <div className="text-[10px] text-muted-foreground">Revenue</div>
                          </div>
                        </div>
                      )}

                      <Button
                        className="w-full bg-gold text-gold-foreground hover:bg-gold/90 mt-auto"
                        onClick={() => loadTemplate(t)}
                        disabled={updateTemplate.isPending}
                      >
                        Load group <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Usage report ─────────────────────────────────────────────────── */}
        <TabsContent value="report">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-gold" />
                Group usage analytics
              </CardTitle>
              {report.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => exportCsv(report)}>
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {report.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  No saved groups yet.
                </div>
              ) : (
                <ScrollArea className="w-full">
                  <div className="min-w-[700px]">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_80px_80px_70px_80px_80px_80px_90px] gap-0 border-b bg-muted/40 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      {["Group Name", "Type", "Vehicle", "Employees", "Total Rides", "Completed", "Avg Fare", "Last Used"].map((h) => (
                        <div key={h} className="px-3 py-2.5">{h}</div>
                      ))}
                    </div>
                    {/* Rows */}
                    {report.map((r) => (
                      <div
                        key={r.id}
                        className="grid grid-cols-[1fr_80px_80px_70px_80px_80px_80px_90px] gap-0 border-b text-xs hover:bg-muted/20 transition-colors"
                      >
                        <div className="px-3 py-3">
                          <div className="font-medium">{r.name}</div>
                          {r.officeName && (
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Building2 className="h-3 w-3" />{r.officeName}
                            </div>
                          )}
                        </div>
                        <div className="px-3 py-3 capitalize">{r.rideType}</div>
                        <div className="px-3 py-3 capitalize text-muted-foreground">{r.vehicleType ?? "any"}</div>
                        <div className="px-3 py-3">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3 text-muted-foreground" />{r.employeeCount}
                          </span>
                        </div>
                        <div className="px-3 py-3 font-medium">{r.totalRides}</div>
                        <div className="px-3 py-3">
                          <span className={`font-medium ${r.completedRides > 0 ? "text-success" : "text-muted-foreground"}`}>
                            {r.completedRides}
                          </span>
                        </div>
                        <div className="px-3 py-3">
                          {r.avgFare > 0 ? (
                            <span className="flex items-center gap-0.5 font-medium">
                              <IndianRupee className="h-3 w-3" />{Math.round(r.avgFare)}
                            </span>
                          ) : "—"}
                        </div>
                        <div className="px-3 py-3 text-muted-foreground text-[10px]">
                          {r.lastUsedAt
                            ? formatDistanceToNow(new Date(r.lastUsedAt), { addSuffix: true })
                            : "Never"}
                        </div>
                      </div>
                    ))}

                    {/* Totals row */}
                    <div className="grid grid-cols-[1fr_80px_80px_70px_80px_80px_80px_90px] gap-0 bg-muted/40 text-xs font-semibold border-t">
                      <div className="px-3 py-2.5 text-muted-foreground">Total</div>
                      <div className="px-3 py-2.5" />
                      <div className="px-3 py-2.5" />
                      <div className="px-3 py-2.5">{report.reduce((s, r) => s + r.employeeCount, 0)}</div>
                      <div className="px-3 py-2.5">{report.reduce((s, r) => s + r.totalRides, 0)}</div>
                      <div className="px-3 py-2.5 text-success">{report.reduce((s, r) => s + r.completedRides, 0)}</div>
                      <div className="px-3 py-2.5 flex items-center gap-0.5">
                        <IndianRupee className="h-3 w-3" />
                        {(report.reduce((s, r) => s + r.totalRevenue, 0) / 1000).toFixed(1)}k
                      </div>
                      <div className="px-3 py-2.5" />
                    </div>
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this saved group?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The group will no longer be available for future bookings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) {
                  deleteTemplate.mutate(deleteId, {
                    onSuccess: () => toast.success("Group deleted"),
                    onError: (e: any) => toast.error(e?.message ?? "Failed"),
                  });
                }
                setDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
