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
  useCreateRouteTemplate,
  useEmployees,
  type RouteTemplateRow,
} from "@/lib/queries";
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
import { EditGroupDialog } from "@/components/EditGroupDialog";
import { RideTypeBadge, RideTypeText } from "@/components/RideTypeLabel";
import { RosterEmployeePanel } from "@/components/RosterEmployeePanel";
import { GroupManifestBlock, parseRowId } from "@/components/GroupManifestBlock";
import { useNavigate } from "react-router-dom";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";

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
  const { data: templatesData } = useRouteTemplates();
  const { data: reportData } = useSavedGroupsReport();
  const { data: employeesData } = useEmployees();
  const updateTemplate = useUpdateRouteTemplate();
  const deleteTemplate = useDeleteRouteTemplate();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const templates = templatesData?.templates ?? [];
  const report = reportData?.report ?? [];
  const allEmployees = employeesData?.employees ?? [];
  const employeesById = new Map(allEmployees.map((e) => [e.id, e]));

  // Group builder: ride direction + employee selection (checked rows), built
  // from the roster. Rules mirror Book-a-ride: one office only, one shift time.
  const [rideType, setRideType] = useState<"login" | "logout">("login");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const createTemplate = useCreateRouteTemplate();

  const createGroup = () => {
    const name = groupName.trim();
    if (!name) { toast.error("Enter a group name"); return; }
    if (selectedIds.length === 0) { toast.error("Tick at least one employee"); return; }
    createTemplate.mutate(
      { name, rideType, orderedEmployeeIds: selectedIds },
      {
        onSuccess: () => {
          toast.success(`Group "${name}" created`);
          setGroupName("");
          setSelectedIds([]);
        },
        onError: (e: any) => toast.error(e?.message ?? "Failed to create group"),
      },
    );
  };
  const selectedSet = new Set(selectedIds);
  const selectedEmployees = selectedIds
    .map((id) => allEmployees.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  // Shift-match rule (same as booking): everyone in the group must share the
  // relevant shift time — shiftStart for login, shiftEnd for logout.
  const shiftTimes = Array.from(
    new Set(selectedEmployees.map((e) => (rideType === "logout" ? e.shiftEnd : e.shiftStart)).filter(Boolean)),
  );
  const shiftMismatch = shiftTimes.length > 1;

  // Office-match rule (same as booking): a group can only mix employees from a
  // single company/office. The first picked employee locks the office.
  const lockedCompany = selectedEmployees.find((e) => e.companyLabel)?.companyLabel ?? null;

  const shiftOf = (e: typeof allEmployees[number]) => (rideType === "logout" ? e.shiftEnd : e.shiftStart);
  const toggleEmployee = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      return;
    }
    const emp = allEmployees.find((e) => e.id === id);
    if (!emp) return;
    const anchor = selectedEmployees[0];
    if (anchor) {
      // Same rules as Book a ride: no mixing companies, one shift time.
      if ((emp.companyLabel ?? null) !== (anchor.companyLabel ?? null)) {
        toast.error("A group can't mix companies/offices", {
          description: `This group is for ${anchor.companyLabel ?? "unassigned"}. Clear it to start another company.`,
        });
        return;
      }
      if (shiftOf(emp) !== shiftOf(anchor)) {
        toast.error("All employees must share the same shift time", {
          description: `${anchor.name}'s ${rideType} time is ${shiftOf(anchor)}; ${emp.name}'s is ${shiftOf(emp)}.`,
        });
        return;
      }
    }
    setSelectedIds((prev) => [...prev, id]);
  };

  // "Load group" now opens an editable preview instead of jumping straight
  // into the booking flow — the supervisor can add/remove people and see the
  // route on a map before committing.
  const [editingTemplate, setEditingTemplate] = useState<RouteTemplateRow | null>(null);

  // ── Drag-and-drop between/within group blocks ──────────────────────────────
  const nav = useNavigate();
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);
  // PointerSensor with a small activation distance → works on mouse AND touch
  // (Android), while still allowing taps on the dropdown/buttons inside rows.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const persistTemplate = (t: RouteTemplateRow, data: { rideType?: "login" | "logout"; orderedEmployeeIds?: string[] }) => {
    setSavingTemplateId(t.id);
    updateTemplate.mutate(
      { id: t.id, ...data },
      {
        onSuccess: () => setSavingTemplateId(null),
        onError: (e: any) => { setSavingTemplateId(null); toast.error(e?.message ?? "Failed to save group"); },
      },
    );
  };

  const bookGroup = (t: RouteTemplateRow) =>
    nav("/supervisor/routes", {
      state: {
        presetEmployeeIds: t.orderedEmployeeIds,
        presetType: t.rideType,
        presetOfficeLocationId: t.officeLocationId ?? undefined,
        presetVehicleType: t.vehicleType ?? undefined,
        presetStep: 2,
      },
    });

  const handleGroupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const { templateId: srcTpl, employeeId } = parseRowId(String(active.id));

    // Resolve the destination group: either a row id ("tpl::emp") or the
    // whole-group droppable ("group:<id>").
    let dstTpl: string;
    let overEmpId: string | null = null;
    const overId = String(over.id);
    if (overId.startsWith("group:")) {
      dstTpl = overId.slice("group:".length);
    } else {
      const parsed = parseRowId(overId);
      dstTpl = parsed.templateId;
      overEmpId = parsed.employeeId;
    }

    const src = templates.find((t) => t.id === srcTpl);
    const dst = templates.find((t) => t.id === dstTpl);
    if (!src || !dst) return;

    if (srcTpl === dstTpl) {
      // Reorder within the same group.
      const ids = [...(src.orderedEmployeeIds as string[])];
      const from = ids.indexOf(employeeId);
      const to = overEmpId ? ids.indexOf(overEmpId) : ids.length - 1;
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      persistTemplate(src, { orderedEmployeeIds: ids });
      return;
    }

    // Move employee from src group → dst group.
    const srcIds = (src.orderedEmployeeIds as string[]).filter((id) => id !== employeeId);
    const dstIds = [...(dst.orderedEmployeeIds as string[])];
    if (dstIds.includes(employeeId)) return; // already there
    const insertAt = overEmpId ? dstIds.indexOf(overEmpId) : dstIds.length;
    dstIds.splice(insertAt < 0 ? dstIds.length : insertAt, 0, employeeId);
    persistTemplate(src, { orderedEmployeeIds: srcIds });
    persistTemplate(dst, { orderedEmployeeIds: dstIds });
  };

  return (
    <div className="w-full">
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

      {/* Merged group builder: one roster table where checked rows = group
          members, with the create-group toolbar (direction + name + create)
          in its header. Same selection rules as Book a ride. */}
      <div className="mb-6">
        <RosterEmployeePanel
          onPick={(e) => toggleEmployee(e.id)}
          selectedIds={selectedSet}
          title="Shift roster — tick employees to add"
          rideType={rideType}
          lockedCompany={lockedCompany}
          lockedShift={shiftTimes.length === 1 ? shiftTimes[0] : null}
          onRideTypeChange={setRideType}
          groupName={groupName}
          onGroupNameChange={setGroupName}
          onCreateGroup={createGroup}
          creating={createTemplate.isPending}
          shiftMismatch={shiftMismatch}
          selectedCount={selectedIds.length}
          height={520}
        />
      </div>

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
                  Pick employees from the roster above and click <b>Save group</b> to create a reusable group.
                </div>
              </CardContent>
            </Card>
          ) : (
            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
              <div className="space-y-4">
                {templates.map((t) => (
                  <GroupManifestBlock
                    key={t.id}
                    template={t}
                    employeesById={employeesById}
                    saving={savingTemplateId === t.id}
                    onRideTypeChange={(rt) => persistTemplate(t, { rideType: rt })}
                    onBook={() => bookGroup(t)}
                    onDelete={() => setDeleteId(t.id)}
                  />
                ))}
              </div>
            </DndContext>
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
                        <div className="px-3 py-3"><RideTypeText type={r.rideType} /></div>
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

      <EditGroupDialog
        template={editingTemplate}
        open={!!editingTemplate}
        onOpenChange={(o) => !o && setEditingTemplate(null)}
      />
    </div>
  );
}
