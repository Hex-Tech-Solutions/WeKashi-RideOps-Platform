/// <reference types="google.maps" />
/**
 * GroupAllocationWorkspace — a MoveInSync-style cab-allocation canvas.
 *
 * Opened from the Saved Groups page. Shows every group for one company side by
 * side, with a shared map on the right drawing the routes of the groups the
 * supervisor has toggled "shown". The supervisor can:
 *   • drag an employee from one group to another (max 6 per group),
 *   • reorder within a group,
 *   • merge two groups into one,
 *   • delete groups that have become empty,
 * all while watching the routes redraw live.
 *
 * STAGED editing: every change is held in local draft state. Nothing is written
 * to the server until "Save all"; "Discard" reverts to the loaded groups. This
 * lets the supervisor experiment freely without a storm of PATCH requests.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useUpdateRouteTemplate, useDeleteRouteTemplate, useOptimizeRoute,
  type RouteTemplateRow, type EmployeeRow,
} from "@/lib/queries";
import { MultiGroupMap, type MapGroup } from "@/components/MultiGroupMap";
import { DROP, getPoint } from "@/lib/geo";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  useDroppable, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Users, GripVertical, Trash2, Eye, EyeOff, GitMerge, Loader2, Save, X, AlertTriangle, MapPin,
} from "lucide-react";
import { toast } from "sonner";

export const MAX_PER_GROUP = 6;

// Distinct, high-contrast colours assigned to groups in order.
const GROUP_COLORS = [
  "#D5B036", "#2563eb", "#16a34a", "#db2777", "#9333ea",
  "#ea580c", "#0891b2", "#4d7c0f", "#be123c", "#7c3aed",
];

interface DraftGroup {
  id: string;
  name: string;
  rideType: "login" | "logout";
  vehicleType?: string | null;
  officeLocationId?: string | null;
  officeLocation?: { name: string; address: string; lat: number; lng: number } | null;
  memberIds: string[];
}

const rowDragId = (groupId: string, empId: string) => `${groupId}::${empId}`;
const parseRowDragId = (id: string) => {
  const [groupId, empId] = id.split("::");
  return { groupId, empId };
};

function toDraft(t: RouteTemplateRow): DraftGroup {
  return {
    id: t.id,
    name: t.name,
    rideType: t.rideType,
    vehicleType: t.vehicleType ?? null,
    officeLocationId: t.officeLocationId ?? null,
    officeLocation: t.officeLocation ?? null,
    memberIds: [...(t.orderedEmployeeIds as string[])],
  };
}

export function GroupAllocationWorkspace({
  open,
  onOpenChange,
  templates,
  employeesById,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The groups to load into the workspace (already filtered to one company). */
  templates: RouteTemplateRow[];
  employeesById: Map<string, EmployeeRow>;
}) {
  const updateTemplate = useUpdateRouteTemplate();
  const deleteTemplate = useDeleteRouteTemplate();
  const optimizeRoute = useOptimizeRoute();

  const [draft, setDraft] = useState<DraftGroup[]>([]);
  const [shownIds, setShownIds] = useState<Set<string>>(new Set());
  const [routeByGroup, setRouteByGroup] = useState<Record<string, { order: string[]; polyline: string | null }>>({});
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);

  // Snapshot the originals so Save-all can diff and Discard can revert.
  const originals = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  // (Re)load draft whenever the workspace is opened with a new template set.
  useEffect(() => {
    if (!open) return;
    setDraft(templates.map(toDraft));
    setShownIds(new Set(templates.slice(0, 1).map((t) => t.id))); // show the first group by default
    setRouteByGroup({});
    setMergeFrom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templates.map((t) => t.id).join(",")]);

  const colorOf = useCallback(
    (groupId: string) => {
      const idx = draft.findIndex((g) => g.id === groupId);
      return GROUP_COLORS[(idx < 0 ? 0 : idx) % GROUP_COLORS.length];
    },
    [draft],
  );

  // Shared office/drop anchor — all groups in one company share it. Derive from
  // the first group that has an officeLocation; fall back to the demo DROP.
  const office = useMemo(() => {
    const withOffice = draft.find((g) => g.officeLocation);
    if (withOffice?.officeLocation) {
      return { name: withOffice.officeLocation.name, lat: withOffice.officeLocation.lat, lng: withOffice.officeLocation.lng };
    }
    const d = getPoint(DROP);
    return { name: DROP, lat: d.lat, lng: d.lng };
  }, [draft]);

  // ── Live route computation for SHOWN groups (debounced) ─────────────────────
  // Only shown groups are routed, so the cost scales with what the supervisor is
  // actually looking at, not the total group count. Keyed by member order so an
  // unchanged group isn't re-requested.
  const lastRequested = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      for (const grp of draft) {
        if (!shownIds.has(grp.id) || grp.memberIds.length === 0) continue;
        const key = grp.memberIds.join(">");
        if (lastRequested.current[grp.id] === key) continue;
        lastRequested.current[grp.id] = key;

        const stops = grp.memberIds
          .map((id) => employeesById.get(id))
          .filter((e): e is EmployeeRow => !!e && e.pickupLat != null && e.pickupLng != null)
          .map((e) => ({ empId: e.id, lat: e.pickupLat as number, lng: e.pickupLng as number }));
        if (!stops.length) continue;

        optimizeRoute.mutate(
          { type: grp.rideType, office: { lat: office.lat, lng: office.lng }, stops, optimize: true },
          {
            onSuccess: (result) => {
              setRouteByGroup((prev) => ({
                ...prev,
                [grp.id]: { order: result.stops.map((s) => s.empId), polyline: result.encodedPolyline },
              }));
            },
            // On failure keep the member order as-is (no polyline).
            onError: () => {
              setRouteByGroup((prev) => ({ ...prev, [grp.id]: { order: grp.memberIds, polyline: null } }));
            },
          },
        );
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, shownIds, office.lat, office.lng]);

  // Map groups — shown groups use their computed (optimized) order + polyline;
  // hidden groups just contribute faint dots in member order.
  const mapGroups: MapGroup[] = useMemo(
    () =>
      draft.map((grp) => {
        const computed = routeByGroup[grp.id];
        const order = computed?.order ?? grp.memberIds;
        const stops = order
          .map((id) => employeesById.get(id))
          .filter((e): e is EmployeeRow => !!e && e.pickupLat != null && e.pickupLng != null)
          .map((e) => ({ empId: e.id, lat: e.pickupLat as number, lng: e.pickupLng as number, name: e.name }));
        return {
          id: grp.id,
          name: grp.name,
          color: colorOf(grp.id),
          stops,
          polyline: shownIds.has(grp.id) ? computed?.polyline ?? null : null,
          type: grp.rideType,
          shown: shownIds.has(grp.id),
        };
      }),
    [draft, routeByGroup, shownIds, employeesById, colorOf],
  );

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const { groupId: srcId, empId } = parseRowDragId(String(active.id));

    let dstId: string;
    let overEmpId: string | null = null;
    const overId = String(over.id);
    if (overId.startsWith("group:")) {
      dstId = overId.slice("group:".length);
    } else {
      const parsed = parseRowDragId(overId);
      dstId = parsed.groupId;
      overEmpId = parsed.empId;
    }

    setDraft((prev) => {
      const src = prev.find((g) => g.id === srcId);
      const dst = prev.find((g) => g.id === dstId);
      if (!src || !dst) return prev;

      if (srcId === dstId) {
        const ids = [...src.memberIds];
        const from = ids.indexOf(empId);
        const to = overEmpId ? ids.indexOf(overEmpId) : ids.length - 1;
        if (from < 0 || to < 0 || from === to) return prev;
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        return prev.map((g) => (g.id === srcId ? { ...g, memberIds: ids } : g));
      }

      if (dst.memberIds.includes(empId)) return prev;
      if (dst.memberIds.length >= MAX_PER_GROUP) {
        toast.error(`"${dst.name}" is full`, { description: `A group can hold at most ${MAX_PER_GROUP} employees.` });
        return prev;
      }
      const srcIds = src.memberIds.filter((id) => id !== empId);
      const dstIds = [...dst.memberIds];
      const insertAt = overEmpId ? dstIds.indexOf(overEmpId) : dstIds.length;
      dstIds.splice(insertAt < 0 ? dstIds.length : insertAt, 0, empId);
      return prev.map((g) =>
        g.id === srcId ? { ...g, memberIds: srcIds } : g.id === dstId ? { ...g, memberIds: dstIds } : g,
      );
    });
  };

  const toggleShown = (id: string) =>
    setShownIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Merge `mergeFrom` INTO `targetId`: target keeps its name/office/vehicle/
  // direction; members are appended; the source group is dropped from the draft.
  const doMerge = (targetId: string) => {
    if (!mergeFrom || mergeFrom === targetId) { setMergeFrom(null); return; }
    setDraft((prev) => {
      const from = prev.find((g) => g.id === mergeFrom);
      const target = prev.find((g) => g.id === targetId);
      if (!from || !target) return prev;
      if (from.rideType !== target.rideType) {
        toast.error("Can't merge across directions", { description: "Both groups must be the same login/logout direction." });
        return prev;
      }
      const combined = [...target.memberIds, ...from.memberIds.filter((id) => !target.memberIds.includes(id))];
      if (combined.length > MAX_PER_GROUP) {
        toast.error("Merge would exceed the limit", { description: `The combined group would have ${combined.length} employees (max ${MAX_PER_GROUP}).` });
        return prev;
      }
      // Drop the source group; keep the target with combined members.
      return prev
        .filter((g) => g.id !== mergeFrom)
        .map((g) => (g.id === targetId ? { ...g, memberIds: combined } : g));
    });
    setShownIds((prev) => { const n = new Set(prev); n.delete(mergeFrom); return n; });
    setMergeFrom(null);
  };

  const removeMember = (groupId: string, empId: string) => {
    setDraft((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, memberIds: g.memberIds.filter((id) => id !== empId) } : g)),
    );
  };

  const removeEmptyGroups = () => {
    const emptyCount = draft.filter((g) => g.memberIds.length === 0).length;
    if (emptyCount === 0) { toast.info("No empty groups to remove"); return; }
    setDraft((prev) => prev.filter((g) => g.memberIds.length > 0));
    toast.success(`Removed ${emptyCount} empty group${emptyCount === 1 ? "" : "s"}`);
  };

  // ── Dirty check + Save all ──────────────────────────────────────────────────
  const dirty = useMemo(() => {
    if (draft.length !== originals.size) return true; // a group was removed/merged away
    for (const g of draft) {
      const orig = originals.get(g.id);
      if (!orig) return true;
      const a = (orig.orderedEmployeeIds as string[]).join(">");
      const b = g.memberIds.join(">");
      if (a !== b) return true;
    }
    return false;
  }, [draft, originals]);

  const saveAll = async () => {
    setSaving(true);
    try {
      const draftIds = new Set(draft.map((g) => g.id));
      // 1. Delete groups that were merged away or removed (empty).
      const removed = [...originals.keys()].filter((id) => !draftIds.has(id));
      for (const id of removed) {
        await deleteTemplate.mutateAsync(id);
      }
      // 2. Update groups whose membership/order changed.
      for (const g of draft) {
        const orig = originals.get(g.id);
        const changed = !orig || (orig.orderedEmployeeIds as string[]).join(">") !== g.memberIds.join(">");
        if (changed) {
          await updateTemplate.mutateAsync({ id: g.id, orderedEmployeeIds: g.memberIds });
        }
      }
      toast.success("Allocation saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save allocation");
    } finally {
      setSaving(false);
    }
  };

  const requestClose = (next: boolean) => {
    if (!next && dirty) { setConfirmDiscard(true); return; }
    onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="max-w-[min(1200px,96vw)] max-h-[92vh] overflow-hidden p-0 flex flex-col">
          <div className="px-4 pt-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                Group allocation
                <Badge variant="outline" className="text-[10px] py-0">{draft.length} groups</Badge>
                {dirty && <Badge className="bg-gold/20 text-gold-dark text-[10px] py-0">unsaved</Badge>}
                {mergeFrom && (
                  <Badge className="bg-blue-500/15 text-blue-700 text-[10px] py-0">
                    Pick a group to merge into — or cancel
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap">
            <Button size="sm" variant="outline" onClick={removeEmptyGroups}>
              <Trash2 className="h-3.5 w-3.5" /> Remove empty
            </Button>
            {mergeFrom ? (
              <Button size="sm" variant="ghost" onClick={() => setMergeFrom(null)}>
                <X className="h-3.5 w-3.5" /> Cancel merge
              </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => requestClose(false)}>Discard</Button>
              <Button
                size="sm"
                className="bg-gold text-gold-foreground hover:bg-gold/90"
                disabled={!dirty || saving}
                onClick={saveAll}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save all
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Left — group columns */}
            <div className="overflow-y-auto p-3 space-y-3 border-r">
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                {draft.map((grp) => (
                  <GroupColumn
                    key={grp.id}
                    group={grp}
                    color={colorOf(grp.id)}
                    employeesById={employeesById}
                    shown={shownIds.has(grp.id)}
                    merging={!!mergeFrom}
                    isMergeSource={mergeFrom === grp.id}
                    onToggleShown={() => toggleShown(grp.id)}
                    onStartMerge={() => setMergeFrom(grp.id)}
                    onMergeInto={() => doMerge(grp.id)}
                    onRemoveMember={(empId) => removeMember(grp.id, empId)}
                  />
                ))}
                {draft.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-10">No groups to allocate.</div>
                )}
              </DndContext>
            </div>

            {/* Right — shared map */}
            <div className="p-3 min-h-[320px]">
              <MultiGroupMap groups={mapGroups} office={office} className="h-full" />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {draft.filter((g) => shownIds.has(g.id)).map((g) => (
                  <span key={g.id} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(g.id) }} />
                    {g.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You've moved people around or merged groups but haven't saved. Closing now
              discards all of it and leaves your saved groups untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmDiscard(false); onOpenChange(false); }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── One group column (droppable + sortable member rows) ──────────────────────

function GroupColumn({
  group,
  color,
  employeesById,
  shown,
  merging,
  isMergeSource,
  onToggleShown,
  onStartMerge,
  onMergeInto,
  onRemoveMember,
}: {
  group: DraftGroup;
  color: string;
  employeesById: Map<string, EmployeeRow>;
  shown: boolean;
  merging: boolean;
  isMergeSource: boolean;
  onToggleShown: () => void;
  onStartMerge: () => void;
  onMergeInto: () => void;
  onRemoveMember: (empId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `group:${group.id}` });
  const members = group.memberIds
    .map((id) => employeesById.get(id))
    .filter((e): e is EmployeeRow => !!e);
  const sortableIds = members.map((e) => rowDragId(group.id, e.id));
  const full = group.memberIds.length >= MAX_PER_GROUP;

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border overflow-hidden transition-colors ${isOver ? "ring-2 ring-gold/60" : ""} ${isMergeSource ? "ring-2 ring-blue-500/60" : ""}`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ background: `${color}14` }}>
        <span className="h-3 w-3 rounded-full shrink-0" style={{ background: color }} />
        <span className="font-semibold text-sm truncate">{group.name}</span>
        <Badge variant="outline" className="capitalize text-[10px] py-0 shrink-0">{group.rideType}</Badge>
        <span className={`flex items-center gap-1 text-xs shrink-0 ${full ? "text-destructive font-medium" : "text-muted-foreground"}`}>
          <Users className="h-3.5 w-3.5" /> {group.memberIds.length}/{MAX_PER_GROUP}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" title={shown ? "Hide route" : "Show route on map"} onClick={onToggleShown}>
            {shown ? <Eye className="h-4 w-4 text-gold-dark" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
          </Button>
          {merging ? (
            <Button size="sm" variant="outline" className="h-7" disabled={isMergeSource} onClick={onMergeInto}>
              {isMergeSource ? "source" : "merge here"}
            </Button>
          ) : (
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Merge another group into this" onClick={onStartMerge}>
              <GitMerge className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      {members.length === 0 ? (
        <div className="px-3 py-5 text-center text-xs text-muted-foreground">
          Empty — drag an employee here, or use “Remove empty”.
        </div>
      ) : (
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <div className="divide-y">
            {members.map((e, i) => (
              <MemberRow
                key={e.id}
                id={rowDragId(group.id, e.id)}
                seq={i + 1}
                employee={e}
                color={color}
                onRemove={() => onRemoveMember(e.id)}
              />
            ))}
          </div>
        </SortableContext>
      )}
      {full && (
        <div className="px-3 py-1 text-[10px] text-destructive bg-destructive/5 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Full — max {MAX_PER_GROUP} per group
        </div>
      )}
    </div>
  );
}

function MemberRow({
  id,
  seq,
  employee: e,
  color,
  onRemove,
}: {
  id: string;
  seq: number;
  employee: EmployeeRow;
  color: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/40 touch-none"
    >
      {/* Only the grip is draggable, so the remove button stays clickable. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground shrink-0"
        aria-label="Drag to move"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: color }}>{seq}</span>
      <span className="font-medium truncate">{e.name}</span>
      {e.gender?.toUpperCase().startsWith("F") ? (
        <Badge variant="outline" className="border-gold/40 bg-gold-soft text-gold-dark text-[10px] py-0 shrink-0">F</Badge>
      ) : null}
      <span className="flex items-center gap-1 text-muted-foreground truncate max-w-[40%] ml-auto" title={e.pickupAddress}>
        <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{e.pickupAddress}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive shrink-0"
        aria-label={`Remove ${e.name} from group`}
        title="Remove from group"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
