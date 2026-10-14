import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCreateRouteTemplate, type EmployeeRow } from "@/lib/queries";
import { rideArea } from "@/lib/rideArea";
import { ChevronUp, ChevronDown, X, Save, Users, Loader2, BookmarkPlus } from "lucide-react";
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

        {/* Ordered selection */}
        <ScrollArea style={{ height }}>
          {selected.length === 0 ? (
            <div className="py-16 px-4 text-center text-sm text-muted-foreground">
              Pick employees from the roster on the left to build a group. They'll appear here in pickup order.
            </div>
          ) : (
            <div className="divide-y">
              {selected.map((e, i) => (
                <div key={e.id} className="px-3 py-2.5 flex items-center gap-3">
                  <div className="flex flex-col -my-1 shrink-0">
                    <button
                      className="h-5 w-5 text-muted-foreground hover:text-gold-dark disabled:opacity-30"
                      disabled={i === 0}
                      onClick={() => onReorder(i, i - 1)}
                      title="Move up"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="h-5 w-5 text-muted-foreground hover:text-gold-dark disabled:opacity-30"
                      disabled={i === selected.length - 1}
                      onClick={() => onReorder(i, i + 1)}
                      title="Move down"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="h-7 w-7 rounded-full bg-gold text-gold-foreground flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{e.name} <span className="font-mono text-[11px] text-muted-foreground">{e.empId}</span></div>
                    {rideArea(e.pickupAddress) && (
                      <div className="text-[11px] font-semibold text-foreground truncate">{rideArea(e.pickupAddress)}</div>
                    )}
                    <div className="text-[11px] text-muted-foreground truncate">{e.pickupAddress}</div>
                  </div>
                  <button
                    className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => onRemove(e.id)}
                    title="Remove"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
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
