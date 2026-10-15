import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEmployees, useOfficeLocations, type EmployeeRow } from "@/lib/queries";
import { Search, Users, Loader2, MapPin } from "lucide-react";
import { rideArea } from "@/lib/rideArea";

/**
 * Shift-roster employee list panel — the full roster with the same
 * search + company filters as the Roster page, inside a fixed-height
 * scroll area. Used as the first layout in Saved Groups.
 *
 * Optional `onPick` lets a parent react to clicking an employee row (e.g. to
 * add them to a group) — purely a hook, the panel works standalone without it.
 */
export function RosterEmployeePanel({
  onPick,
  selectedIds,
  title = "Shift roster",
  height = 440,
  rideType = "login",
  lockedCompany = null,
  lockedShift = null,
}: {
  onPick?: (e: EmployeeRow) => void;
  selectedIds?: Set<string>;
  title?: string;
  height?: number;
  /** Ride direction — decides which shift time (start/end) must match. */
  rideType?: "login" | "logout";
  /** Once a group has an employee with a company, only that company is pickable. */
  lockedCompany?: string | null;
  /** Once a group has a shift time, only employees on that shift are pickable. */
  lockedShift?: string | null;
}) {
  const { data, isLoading } = useEmployees();
  const { data: locationsData } = useOfficeLocations();
  const employees = data?.employees ?? [];
  const offices = locationsData?.offices ?? [];

  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");

  const companies = useMemo(
    () => Array.from(new Set(employees.map((e) => e.companyLabel).filter(Boolean) as string[])),
    [employees],
  );

  const filtered = useMemo(
    () =>
      employees
        .filter((e) => company === "all" || e.companyLabel === company)
        .filter(
          (e) =>
            e.name.toLowerCase().includes(q.toLowerCase()) ||
            e.empId.toLowerCase().includes(q.toLowerCase()),
        ),
    [employees, company, q],
  );

  const isFemale = (g: string) => g?.toUpperCase().startsWith("F");

  return (
    <Card className="shadow-card">
      <CardContent className="p-0">
        {/* Header + filters */}
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gold" />
            <span className="font-semibold text-sm">{title}</span>
            <Badge variant="outline" className="ml-auto text-[10px]">
              {filtered.length} of {employees.length}
            </Badge>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          {companies.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setCompany("all")}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  company === "all" ? "bg-foreground text-background border-foreground" : "border-border hover:border-foreground/40"
                }`}
              >
                All
              </button>
              {companies.map((c) => (
                <button
                  key={c}
                  onClick={() => setCompany(c)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    company === c ? "bg-gold text-gold-foreground border-gold" : "border-border hover:border-gold/40"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Table — MoveInSync-style columns: ☑ · Emp ID · Name · G · Landmark · Address · dir */}
        <ScrollArea style={{ height }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b">
                <th className="w-8 px-2 py-2"></th>
                <th className="text-left font-medium px-2 py-2 w-16">Emp ID</th>
                <th className="text-left font-medium px-2 py-2">Name</th>
                <th className="w-8 px-1 py-2 text-center">G</th>
                <th className="text-left font-medium px-2 py-2">Landmark</th>
                <th className="text-left font-medium px-2 py-2">Address</th>
                <th className="w-10 px-1 py-2 text-center">{rideType === "logout" ? "Drop" : "Pick"}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  {employees.length === 0 ? "No employees yet." : "No employees match your search."}
                </td></tr>
              )}
              {filtered.map((e) => {
                const picked = selectedIds?.has(e.id);
                const empShift = rideType === "logout" ? e.shiftEnd : e.shiftStart;
                const companyBlocked = !picked && !!lockedCompany && (e.companyLabel ?? null) !== lockedCompany;
                const shiftBlocked = !picked && !!lockedShift && empShift !== lockedShift;
                const blocked = !!onPick && (companyBlocked || shiftBlocked);
                return (
                  <tr
                    key={e.id}
                    onClick={() => onPick && !blocked && onPick(e)}
                    title={
                      companyBlocked ? `Different company — a group can only mix one office (${lockedCompany}).`
                      : shiftBlocked ? `Different ${rideType === "logout" ? "logout" : "login"} time — a group must share one shift (${lockedShift}).`
                      : undefined
                    }
                    className={`border-b last:border-0 transition-colors ${
                      !onPick ? "" : blocked ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"
                    } ${picked ? "bg-gold/10" : ""}`}
                  >
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" readOnly checked={!!picked} className="accent-[hsl(var(--gold))] pointer-events-none" />
                    </td>
                    <td className="px-2 py-2 font-mono text-muted-foreground">{e.empId}</td>
                    <td className="px-2 py-2 font-medium">{e.name}</td>
                    <td className="px-1 py-2 text-center">
                      {isFemale(e.gender)
                        ? <span className="text-gold-dark font-semibold">F</span>
                        : <span className="text-muted-foreground">M</span>}
                    </td>
                    <td className="px-2 py-2 font-semibold text-foreground">{rideArea(e.pickupAddress) ?? "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground max-w-[220px] truncate" title={e.pickupAddress}>{e.pickupAddress}</td>
                    <td className="px-1 py-2 text-center">
                      <MapPin className={`h-3.5 w-3.5 inline ${rideType === "logout" ? "text-sky-500" : "text-red-500"}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
