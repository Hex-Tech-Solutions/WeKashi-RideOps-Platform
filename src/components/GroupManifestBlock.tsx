import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rideArea } from "@/lib/rideArea";
import type { EmployeeRow, RouteTemplateRow } from "@/lib/queries";
import { Users, Car, Building2, Trash2, MapPin, GripVertical, Radio, Loader2, Pencil } from "lucide-react";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

/** Composite drag id so the parent can route a drop: "<templateId>::<employeeId>". */
export const rowId = (templateId: string, employeeId: string) => `${templateId}::${employeeId}`;
export const parseRowId = (id: string) => {
  const [templateId, employeeId] = id.split("::");
  return { templateId, employeeId };
};

/**
 * A saved group as a MoveInSync-style manifest block with touch-friendly
 * drag-and-drop (dnd-kit): drag rows to reorder within the group OR drag an
 * employee from one group block into another. Login/logout and reorder persist
 * to the saved group; "Book ride" hands it to the normal booking flow.
 *
 * The parent owns the DndContext; this block is a droppable sortable container.
 */
export function GroupManifestBlock({
  template,
  employeesById,
  onRideTypeChange,
  onBook,
  onDelete,
  onEditAddress,
  saving = false,
}: {
  template: RouteTemplateRow;
  employeesById: Map<string, EmployeeRow>;
  onRideTypeChange: (rideType: "login" | "logout") => void;
  onBook: () => void;
  onDelete: () => void;
  onEditAddress: (employee: EmployeeRow) => void;
  saving?: boolean;
}) {
  const ids = template.orderedEmployeeIds as string[];
  const members = ids.map((id) => employeesById.get(id)).filter((e): e is EmployeeRow => !!e);
  const isLogout = template.rideType === "logout";

  // Whole block is a drop zone so an employee can be dropped onto an empty group.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `group:${template.id}` });
  const sortableIds = members.map((e) => rowId(template.id, e.id));

  return (
    <div
      ref={setDropRef}
      className={`rounded-lg border shadow-card overflow-hidden transition-colors ${isOver ? "ring-2 ring-gold/60" : ""}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 bg-muted/40 border-b">
        <span className="font-semibold text-sm">{template.name}</span>
        <Select value={template.rideType} onValueChange={(v) => onRideTypeChange(v as "login" | "logout")}>
          <SelectTrigger className="h-7 w-[104px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="login"><span className="text-green-700 font-medium">Login</span></SelectItem>
            <SelectItem value="logout"><span className="text-red-700 font-medium">Logout</span></SelectItem>
          </SelectContent>
        </Select>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {members.length}
        </span>
        {template.vehicleType && (
          <Badge variant="outline" className="capitalize text-[10px] py-0">
            <Car className="h-3 w-3 mr-1" />{template.vehicleType}
          </Badge>
        )}
        {template.officeLocation && (
          <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> {template.officeLocation.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={onBook}>
            <Radio className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Book ride</span>
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Member manifest — drag rows to reorder or move between groups */}
      <div className="overflow-x-auto">
        {members.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            Empty group — drag an employee here.
          </div>
        ) : (
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className="min-w-[600px]">
              {/* header row */}
              <div className="grid grid-cols-[52px_64px_1fr_28px_120px_1fr_72px_40px_32px] gap-1 text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-background px-1 py-1.5 sticky top-0 z-10">
                <div>Seq</div><div>Emp ID</div><div>Name</div><div className="text-center">G</div><div>Landmark</div><div>Address</div><div className="text-center">Login/Out</div><div className="text-center">{isLogout ? "Drop" : "Pick"}</div><div></div>
              </div>
              {/* Cap each group to ~8 rows with its own scroll. */}
              <div className="max-h-[300px] overflow-y-auto">
                {members.map((e, i) => (
                  <SortableRow
                    key={e.id}
                    id={rowId(template.id, e.id)}
                    seq={i + 1}
                    employee={e}
                    isLogout={isLogout}
                    onEditAddress={() => onEditAddress(e)}
                  />
                ))}
              </div>
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  );
}

function SortableRow({
  id,
  seq,
  employee: e,
  isLogout,
  onEditAddress,
}: {
  id: string;
  seq: number;
  employee: EmployeeRow;
  isLogout: boolean;
  onEditAddress: () => void;
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
      {...attributes}
      {...listeners}
      className="grid grid-cols-[52px_64px_1fr_28px_120px_1fr_72px_40px_32px] gap-1 items-center border-b last:border-0 px-1 py-1.5 text-xs cursor-grab active:cursor-grabbing hover:bg-muted/40 touch-none"
    >
      <div className="flex items-center gap-1">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="h-5 w-5 rounded-full bg-gold text-gold-foreground flex items-center justify-center text-[10px] font-bold">{seq}</span>
      </div>
      <div className="font-mono text-muted-foreground truncate">{e.empId}</div>
      <div className="font-medium truncate">{e.name}</div>
      <div className="text-center">
        {e.gender?.toUpperCase().startsWith("F")
          ? <span className="text-gold-dark font-semibold">F</span>
          : <span className="text-muted-foreground">M</span>}
      </div>
      <div className="font-semibold text-foreground truncate">{rideArea(e.pickupAddress) ?? "—"}</div>
      <div className="text-muted-foreground truncate" title={e.pickupAddress}>{e.pickupAddress}</div>
      <div className="text-center font-mono text-[10px] text-muted-foreground leading-tight">
        <div>{e.shiftStart}</div>
        <div>{e.shiftEnd}</div>
      </div>
      <div className="text-center">
        <MapPin className={`h-3.5 w-3.5 inline ${isLogout ? "text-sky-500" : "text-red-500"}`} />
      </div>
      <div className="text-center">
        <button
          type="button"
          // Keep the drag listeners from hijacking the click.
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => { ev.stopPropagation(); onEditAddress(); }}
          className="text-muted-foreground hover:text-gold-dark"
          title="Edit address"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
