import { useMemo, useState } from "react";
import { GripVertical, X, Plus, ShieldCheck, ShieldAlert, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RouteResult, RouteStop } from "@/lib/geo";

interface Props {
  route: RouteResult;
  type?: "login" | "logout";
  editable?: boolean;
  onReorder?: (from: number, to: number) => void;
  onRemove?: (empId: string) => void;
  onAdd?: () => void;
  onAutoFix?: () => void;
}

export function RouteMap({ route, type = "login", editable, onReorder, onRemove, onAdd, onAutoFix }: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const polyline = useMemo(() => {
    const stopPts = route.stops.map((s) => `${s.point.x},${s.point.y}`);
    const officePt = `${route.drop.point.x},${route.drop.point.y}`;
    const pts = type === "logout" ? [officePt, ...stopPts] : [...stopPts, officePt];
    return pts.join(" ");
  }, [route, type]);
  const officeLabel = type === "logout" ? "Start" : "Final drop";

  return (
    <div className="space-y-4">
      {/* Map */}
      <div
        className="relative rounded-lg border overflow-hidden bg-muted"
        style={{
          backgroundImage:
            "linear-gradient(hsl(0 0% 88%) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 88%) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          aspectRatio: "2 / 1",
        }}
      >
        <svg viewBox="0 0 800 400" className="absolute inset-0 w-full h-full">
          {route.stops.length > 0 && (
            <polyline
              points={polyline}
              fill="none"
              stroke="hsl(var(--gold))"
              strokeWidth="3"
              strokeDasharray="8 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {route.stops.map((s, i) => (
            <g key={s.empId}>
              <circle cx={s.point.x} cy={s.point.y} r="16" fill="hsl(var(--gold))" stroke="white" strokeWidth="3" />
              <text x={s.point.x} y={s.point.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="hsl(var(--gold-foreground))">{i + 1}</text>
            </g>
          ))}
          <g>
            <rect x={route.drop.point.x - 18} y={route.drop.point.y - 18} width="36" height="36" rx="6" fill="hsl(var(--foreground))" stroke="white" strokeWidth="3" />
            <text x={route.drop.point.x} y={route.drop.point.y + 6} textAnchor="middle" fontSize="16" fontWeight="700" fill="hsl(var(--background))">★</text>
          </g>
        </svg>
        <div className="absolute bottom-3 left-3 bg-card/95 rounded-md px-3 py-2 text-xs flex items-center gap-3 border">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-gold" /> {type === "logout" ? "Drop" : "Pickup"}</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-foreground" /> {officeLabel}: {route.drop.name}</span>
        </div>
        <div className="absolute top-3 right-3 bg-card/95 rounded-md px-3 py-2 text-xs border space-y-0.5">
          <div className="font-semibold">{route.totalKm} km · ~{route.etaMin} min</div>
          <div className="text-muted-foreground">{route.stops.length} stop{route.stops.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* Safety */}
      {route.stops.length > 0 && (
        <div className={cn("flex items-center gap-3 p-3 rounded-md border text-sm",
          route.safetyOk ? "bg-success/5 border-success/30 text-success" : "bg-warning/10 border-warning/40 text-warning")}>
          {route.safetyOk ? <ShieldCheck className="h-4 w-4 shrink-0" /> : <ShieldAlert className="h-4 w-4 shrink-0" />}
          <div className="flex-1">
            {route.safetyOk ? "All female-safety rules satisfied" : route.safetyIssue}
          </div>
          {!route.safetyOk && onAutoFix && (
            <Button size="sm" variant="outline" onClick={onAutoFix}>Auto-fix</Button>
          )}
        </div>
      )}

      {/* Stops list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{type === "logout" ? "Drop sequence" : "Pickup sequence"}{editable ? " · drag to reorder" : ""}</div>
          {editable && onAdd && (
            <Button size="sm" variant="outline" onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Add stop</Button>
          )}
        </div>
        {route.stops.length === 0 && (
          <div className="text-sm text-muted-foreground p-6 text-center border-2 border-dashed rounded-md">
            Pick employees to build a route
          </div>
        )}
        {route.stops.map((s, i) => (
          <StopRow
            key={s.empId}
            stop={s}
            idx={i}
            editable={!!editable}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx !== null && dragIdx !== i && onReorder) onReorder(dragIdx, i);
              setDragIdx(null);
            }}
            onRemove={onRemove ? () => onRemove(s.empId) : undefined}
          />
        ))}
        {route.stops.length > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-md border-2 border-foreground bg-foreground/5">
            <div className="h-8 w-8 rounded-md bg-foreground text-background flex items-center justify-center text-xs">★</div>
            <div className="flex-1">
              <div className="font-medium text-sm">{route.drop.name}</div>
              <div className="text-xs text-muted-foreground">{officeLabel} · Office</div>
            </div>
            <div className="text-xs font-medium">~{route.etaMin} min total</div>
          </div>
        )}
      </div>
    </div>
  );
}

function StopRow({ stop, idx, editable, onRemove, onDragStart, onDragOver, onDrop }: {
  stop: RouteStop; idx: number; editable: boolean;
  onRemove?: () => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}) {
  return (
    <div
      draggable={editable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn("flex items-center gap-3 p-3 rounded-md border bg-card", editable && "cursor-move hover:border-gold")}
    >
      {editable && <GripVertical className="h-4 w-4 text-muted-foreground" />}
      <div className="h-8 w-8 rounded-full bg-gold text-gold-foreground flex items-center justify-center text-xs font-bold shrink-0">{idx + 1}</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2">
          {stop.name}
          {stop.gender === "F" && <Badge variant="outline" className="border-gold/40 bg-gold-soft text-gold-dark text-[10px] py-0">Female</Badge>}
        </div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1"><MapPin className="h-3 w-3" /> {stop.location}</div>
      </div>
      {editable && onRemove && (
        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onRemove}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
