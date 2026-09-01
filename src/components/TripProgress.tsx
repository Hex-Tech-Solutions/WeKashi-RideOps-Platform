import { Badge } from "@/components/ui/badge";
import { useRidePax } from "@/lib/queries";
import { Loader2, LogIn, LogOut, Shield, UserCheck } from "lucide-react";

// Live per-passenger trip status shown to supervisors/admins.
// For login rides both the pickup OTP and drop OTP are displayed so the
// supervisor can relay whichever is needed to the employee.
export function TripProgress({ rideId, type }: { rideId: string; type: string }) {
  const { data, isLoading } = useRidePax(rideId);
  const isLogin = type !== "logout";
  const pax = data?.pax ?? [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    );
  }

  if (pax.length === 0) {
    return <div className="text-sm text-muted-foreground py-2">No passengers on this ride.</div>;
  }

  return (
    <div className="space-y-3">
      {/* Escort return-drop OTP — logout escort rides only. This OTP is
          verbal-only: relay it to the driver directly after confirming with
          the escort in person, do not text/forward it to the escort. */}
      {!isLogin && data?.escortRequired && (
        <div className="rounded-md border border-amber-400/60 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-700 shrink-0" />
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider font-semibold text-amber-700">Escort return-drop</div>
              <div className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
                <UserCheck className="h-3.5 w-3.5" /> {data?.escortName ?? "Escort"}
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] py-0 ${
                data?.escortDroppedAt ? "border-success/40 text-success" : "border-amber-400/60 text-amber-700"
              }`}
            >
              {data?.escortDroppedAt ? "dropped ✓" : "in cab"}
            </Badge>
          </div>
          {!data?.escortDroppedAt && data?.escortOtp && (
            <div className="flex items-center gap-1.5 rounded px-2 py-1.5 border border-amber-400/40 bg-white">
              <div className="min-w-0">
                <div className="text-[10px] text-amber-700 leading-none mb-0.5">Escort drop OTP</div>
                <div className="font-mono text-sm font-bold tracking-widest text-amber-900">{data.escortOtp}</div>
              </div>
            </div>
          )}
          <p className="text-[11px] text-amber-700">
            Give this OTP to the driver by phone/in person once you've confirmed with the escort they've been
            dropped back at the office. Do not forward it to the escort directly.
          </p>
        </div>
      )}

      {/* Both ride types now follow the same OTP pattern: a "board" OTP
          (home pickup for login, office boarding for logout) and a drop OTP
          (office drop for login, home drop for logout). Only the label
          differs. */}
      <p className="text-xs text-muted-foreground">
        Each employee has two OTPs — share the{" "}
        <span className="font-semibold text-foreground">{isLogin ? "Pickup" : "Boarding"} OTP</span> when they
        board and the <span className="font-semibold text-foreground">Drop OTP</span> when they alight.
      </p>
      {pax.map((p) => {
        const boardStatus = p.noShow ? "no-show" : p.pickedAt ? "verified" : "pending";
        const dropStatus = p.noShow ? "—" : p.droppedAt ? "verified" : p.pickedAt ? "pending" : "—";

        return (
          <div key={p.id} className="rounded-md border p-3 space-y-2 text-sm">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {p.seq + 1}. {p.name}
              </span>
              {p.noShow && (
                <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px] py-0">
                  no-show
                </Badge>
              )}
              {!p.noShow && p.droppedAt && (
                <Badge variant="outline" className="border-success/40 text-success text-[10px] py-0">
                  completed ✓
                </Badge>
              )}
              {!p.noShow && p.pickedAt && !p.droppedAt && (
                <Badge variant="outline" className="border-gold/50 text-gold-dark text-[10px] py-0">
                  on board
                </Badge>
              )}
              {!p.noShow && !p.pickedAt && (
                <Badge variant="outline" className="text-[10px] py-0">
                  waiting
                </Badge>
              )}
            </div>

            {/* OTP row */}
            <div className="grid grid-cols-2 gap-2">
              {/* Board OTP */}
              <div className={`flex items-center gap-1.5 rounded px-2 py-1.5 border ${
                boardStatus === "verified"
                  ? "border-success/30 bg-success/5"
                  : boardStatus === "no-show"
                  ? "border-destructive/20 bg-destructive/5"
                  : "border-border bg-secondary"
              }`}>
                <LogIn className={`h-3 w-3 shrink-0 ${
                  boardStatus === "verified" ? "text-success" :
                  boardStatus === "no-show" ? "text-destructive" : "text-muted-foreground"
                }`} />
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{isLogin ? "Pickup" : "Boarding"} OTP</div>
                  {p.pickupOtp ? (
                    <div className={`font-mono text-sm font-bold tracking-widest ${
                      boardStatus === "verified" ? "text-success" :
                      boardStatus === "no-show" ? "text-destructive line-through" : "text-foreground"
                    }`}>
                      {p.pickupOtp}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">—</div>
                  )}
                </div>
                {boardStatus === "verified" && (
                  <span className="ml-auto text-[10px] text-success font-medium">✓</span>
                )}
              </div>

              {/* Drop OTP */}
              <div className={`flex items-center gap-1.5 rounded px-2 py-1.5 border ${
                dropStatus === "verified"
                  ? "border-success/30 bg-success/5"
                  : dropStatus === "pending"
                  ? "border-gold/30 bg-gold/5"
                  : "border-border bg-secondary"
              }`}>
                <LogOut className={`h-3 w-3 shrink-0 ${
                  dropStatus === "verified" ? "text-success" :
                  dropStatus === "pending" ? "text-gold-dark" : "text-muted-foreground"
                }`} />
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground leading-none mb-0.5">Drop OTP</div>
                  {p.dropOtp ? (
                    <div className={`font-mono text-sm font-bold tracking-widest ${
                      dropStatus === "verified" ? "text-success" : "text-foreground"
                    }`}>
                      {p.dropOtp}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">—</div>
                  )}
                </div>
                {dropStatus === "verified" && (
                  <span className="ml-auto text-[10px] text-success font-medium">✓</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
