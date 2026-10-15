import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCreateRouteTemplate, type EmployeeRow } from "@/lib/queries";
import { rideArea } from "@/lib/rideArea";
import { ChevronUp, ChevronDown, X, Save, Users, Loader2, BookmarkPlus, MapPin } from "lucide-react";
import { toast } from "sonner";

/**
 * Group builder — the second layout in Saved Groups. Shows the employees the
 * supervisor picked from the roster panel, in pickup order (reorderable), and
 * saves them as a reusable group (route template) directly here.
 */
export function GroupBuilderPanel({
  selected,
  rideType,
  onRideTypeChange,
  shiftMismatch = false,
  onReorder,
  onRemove,
  onClear,
  height = 440,
}: {
  selected: EmployeeRow[];
  rideType: "login" | "logout";
  onRideTypeChange: (t: "login" | "logout") => void;
  shiftMismatch?: boolean;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  height?: number;
}) {
  const [name, setName] = useState("");
  const save = useCreateRouteTemplate();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Enter a name for this group"); return; }
    if (selected.length === 0) { toast.error("Pick at least one employee from the roster"); return; }
    if (shiftMismatch) { toast.error("All employees must share the same shift time"); return; }
    save.mutate(
      { name: trimmed, rideType, orderedEmployeeIds: selected.map((e) => e.id) },
      {
        onSuccess: () => {
          toast.success(`Group "${trimmed}" saved`);
          setName("");
          onClear();
        },
        onError: (e: any) => toast.error(e?.message ?? "Failed to save group"),
      },
    );
  };

  return (
    <Card className="shadow-card">
      <CardContent className="p-0">
        {/* Header */}
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            <BookmarkPlus className="h-4 w-4 text-gold" />
            <span className="font-semibold text-sm">New group</span>
            <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {selected.length} selected
            </span>
          </div>
          <Tabs value={rideType} onValueChange={(v) => onRideTypeChange(v as "login" | "logout")}>
            <TabsList className="w-full">
              <TabsTrigger value="login" className="flex-1 text-green-700 data-[state=active]:text-gold-foreground">Login</TabsTrigger>
              <TabsTrigger value="logout" className="flex-1 text-red-700 data-[state=active]:text-gold-foreground">Logout</TabsTrigger>
            </TabsList>
          </Tabs>
          {shiftMismatch && (
            <div className="text-[11px] text-destructive">
              Employees have different shift times — a group must share one shift.
            </div>
          )}
        </div>

        {/* Ordered selection — manifest table: # · Emp ID · Name · G · Landmark · Address · dir */}
        <ScrollArea style={{ height }}>
          {selected.length === 0 ? (
            <div className="py-16 px-4 text-center text-sm text-muted-foreground">
              Pick employees from the roster above to build a group. They'll appear here in pickup order.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="w-14 px-2 py-2 text-left font-medium">Seq</th>
                  <th className="w-16 px-2 py-2 text-left font-medium">Emp ID</th>
                  <th className="text-left font-medium px-2 py-2">Name</th>
                  <th className="w-8 px-1 py-2 text-center">G</th>
                  <th className="text-left font-medium px-2 py-2">Landmark</th>
                  <th className="text-left font-medium px-2 py-2">Address</th>
                  <th className="w-10 px-1 py-2 text-center">{rideType === "logout" ? "Drop" : "Pick"}</th>
                  <th className="w-8 px-1 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {selected.map((e, i) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <span className="h-5 w-5 rounded-full bg-gold text-gold-foreground flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                        <span className="flex flex-col -my-1">
                          <button className="h-4 w-4 text-muted-foreground hover:text-gold-dark disabled:opacity-30" disabled={i === 0} onClick={() => onReorder(i, i - 1)} title="Move up">
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button className="h-4 w-4 text-muted-foreground hover:text-gold-dark disabled:opacity-30" disabled={i === selected.length - 1} onClick={() => onReorder(i, i + 1)} title="Move down">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 font-mono text-muted-foreground">{e.empId}</td>
                    <td className="px-2 py-2 font-medium">{e.name}</td>
                    <td className="px-1 py-2 text-center">
                      {e.gender?.toUpperCase().startsWith("F")
                        ? <span className="text-gold-dark font-semibold">F</span>
                        : <span className="text-muted-foreground">M</span>}
                    </td>
                    <td className="px-2 py-2 font-semibold text-foreground">{rideArea(e.pickupAddress) ?? "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground max-w-[200px] truncate" title={e.pickupAddress}>{e.pickupAddress}</td>
                    <td className="px-1 py-2 text-center">
                      <MapPin className={`h-3.5 w-3.5 inline ${rideType === "logout" ? "text-sky-500" : "text-red-500"}`} />
                    </td>
                    <td className="px-1 py-2 text-center">
                      <button className="text-muted-foreground hover:text-destructive" onClick={() => onRemove(e.id)} title="Remove">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ScrollArea>

        {/* Save bar */}
        <div className="p-3 border-t space-y-2">
          <Input
            placeholder="Group name (e.g. BTM Morning Login)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9"
          />
          <div className="flex gap-2">
            {selected.length > 0 && (
              <Button variant="outline" size="sm" className="shrink-0" onClick={onClear} disabled={save.isPending}>
                Clear
              </Button>
            )}
            <Button
              className="flex-1 bg-gold text-gold-foreground hover:bg-gold/90"
              onClick={submit}
              disabled={save.isPending || selected.length === 0 || shiftMismatch}
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" /> Save group</>}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
