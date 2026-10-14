import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEmployees, useOfficeLocations, type EmployeeRow } from "@/lib/queries";
import { Search, Users, Building2, Loader2 } from "lucide-react";

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

        {/* Scrollable list */}
        <ScrollArea style={{ height }}>
          <div className="divide-y">
            {isLoading && (
              <div className="py-12 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" />
              </div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {employees.length === 0 ? "No employees yet." : "No employees match your search."}
              </div>
            )}
            {filtered.map((e) => {
              const picked = selectedIds?.has(e.id);
              const empShift = rideType === "logout" ? e.shiftEnd : e.shiftStart;
              // Same rules as Book-a-ride: can't mix companies or shift times.
              const companyBlocked = !picked && !!lockedCompany && (e.companyLabel ?? null) !== lockedCompany;
              const shiftBlocked = !picked && !!lockedShift && empShift !== lockedShift;
              const blocked = !!onPick && (companyBlocked || shiftBlocked);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => !blocked && onPick?.(e)}
                  disabled={!onPick || blocked}
                  title={
                    companyBlocked ? `Different company — a group can only mix one office (${lockedCompany}).`
                    : shiftBlocked ? `Different ${rideType === "logout" ? "logout" : "login"} time — a group must share one shift (${lockedShift}).`
                    : undefined
                  }
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                    !onPick ? "cursor-default"
                    : blocked ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-muted/50 cursor-pointer"
                  } ${picked ? "bg-gold/10" : ""}`}
                >
                  <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold shrink-0">
                    {e.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{e.name}</span>
                      {isFemale(e.gender) && (
                        <Badge variant="outline" className="border-gold/40 text-gold-dark bg-gold-soft text-[10px] py-0">F</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      <span className="font-mono">{e.empId}</span>
                      {e.companyLabel && (
                        <span className="inline-flex items-center gap-0.5 ml-1.5">
                          <Building2 className="h-3 w-3" /> {e.companyLabel}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{e.pickupAddress}</div>
                  </div>
                  <div className="text-right shrink-0 text-[11px] font-mono text-muted-foreground">
                    <div>Login {e.shiftStart}</div>
                    <div>Logout {e.shiftEnd}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
