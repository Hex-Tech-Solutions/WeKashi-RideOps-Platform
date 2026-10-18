import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RideTypeBadge } from "@/components/RideTypeLabel";
import { rideArea } from "@/lib/rideArea";
import type { EmployeeRow, RouteTemplateRow } from "@/lib/queries";
import { Users, Car, Building2, ArrowRight, Trash2, MapPin } from "lucide-react";

/**
 * A saved group rendered as a MoveInSync-style manifest block: a header with
 * the group name / type / pax count / vehicle / office, then the member rows
 * in order (Seq · Emp ID · Name · G · Landmark · Address). Employee details
 * are resolved from the roster the parent already loaded.
 */
export function GroupManifestBlock({
  template,
  employeesById,
  onLoad,
  onDelete,
}: {
  template: RouteTemplateRow;
  employeesById: Map<string, EmployeeRow>;
  onLoad: () => void;
  onDelete: () => void;
}) {
  const ids = template.orderedEmployeeIds as string[];
  const members = ids.map((id) => employeesById.get(id)).filter((e): e is EmployeeRow => !!e);
  const isLogout = template.rideType === "logout";

  return (
    <div className="rounded-lg border shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 bg-muted/40 border-b">
        <span className="font-semibold text-sm">{template.name}</span>
        <RideTypeBadge type={template.rideType} className="text-[10px] py-0" />
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {members.length}
        </span>
        {template.vehicleType && (
          <Badge variant="outline" className="capitalize text-[10px] py-0">
            <Car className="h-3 w-3 mr-1" />{template.vehicleType}
          </Badge>
        )}
        {template.officeLocation && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> {template.officeLocation.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={onLoad}>
            Load group <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Member manifest */}
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-background">
          <tr>
            <th className="w-12 px-2 py-1.5 text-left font-medium">Seq</th>
            <th className="w-16 px-2 py-1.5 text-left font-medium">Emp ID</th>
            <th className="text-left font-medium px-2 py-1.5">Name</th>
            <th className="w-8 px-1 py-1.5 text-center">G</th>
            <th className="text-left font-medium px-2 py-1.5">Landmark</th>
            <th className="text-left font-medium px-2 py-1.5">Address</th>
            <th className="w-10 px-1 py-1.5 text-center">{isLogout ? "Drop" : "Pick"}</th>
          </tr>
        </thead>
        <tbody>
          {members.length === 0 ? (
            <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">No employees in this group.</td></tr>
          ) : (
            members.map((e, i) => (
              <tr key={e.id} className="border-b last:border-0">
                <td className="px-2 py-1.5">
                  <span className="h-5 w-5 rounded-full bg-gold text-gold-foreground flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                </td>
                <td className="px-2 py-1.5 font-mono text-muted-foreground">{e.empId}</td>
                <td className="px-2 py-1.5 font-medium">{e.name}</td>
                <td className="px-1 py-1.5 text-center">
                  {e.gender?.toUpperCase().startsWith("F")
                    ? <span className="text-gold-dark font-semibold">F</span>
                    : <span className="text-muted-foreground">M</span>}
                </td>
                <td className="px-2 py-1.5 font-semibold text-foreground">{rideArea(e.pickupAddress) ?? "—"}</td>
                <td className="px-2 py-1.5 text-muted-foreground max-w-[220px] truncate" title={e.pickupAddress}>{e.pickupAddress}</td>
                <td className="px-1 py-1.5 text-center">
                  <MapPin className={`h-3.5 w-3.5 inline ${isLogout ? "text-sky-500" : "text-red-500"}`} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
