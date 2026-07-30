import { Badge } from "@/components/ui/badge";
import { useRidePax } from "@/lib/queries";
import { Loader2, LogIn, LogOut } from "lucide-react";

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
      {isLogin ? (
        <>
          <p className="text-xs text-muted-foreground">
            Each employee has two OTPs — share the{" "}
            <span className="font-semibold text-foreground">Pickup OTP</span> when they board and
            the <span className="font-semibold text-foreground">Drop OTP</span> when they alight.
          </p>
          {pax.map((p) => {
            const pickupStatus = p.noShow ? "no-show" : p.pickedAt ? "verified" : "pending";
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
                  {/* Pickup OTP */}
                  <div className={`flex items-center gap-1.5 rounded px-2 py-1.5 border ${
                    pickupStatus === "verified"
                      ? "border-success/30 bg-success/5"
                      : pickupStatus === "no-show"
                      ? "border-destructive/20 bg-destructive/5"
                      : "border-border bg-secondary"
                  }`}>
                    <LogIn className={`h-3 w-3 shrink-0 ${
                      pickupStatus === "verified" ? "text-success" :
                      pickupStatus === "no-show" ? "text-destructive" : "text-muted-foreground"
                    }`} />
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground leading-none mb-0.5">Pickup OTP</div>
                      {p.pickupOtp ? (
                        <div className={`font-mono text-sm font-bold tracking-widest ${
                          pickupStatus === "verified" ? "text-success" :
                          pickupStatus === "no-show" ? "text-destructive line-through" : "text-foreground"
                        }`}>
                          {p.pickupOtp}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground">—</div>
                      )}
                    </div>
                    {pickupStatus === "verified" && (
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
        </>
      ) : (
        /* Logout ride — single drop OTP per passenger */
        <>
          <p className="text-xs text-muted-foreground">
            Share the <span className="font-semibold text-foreground">Drop OTP</span> with each
            employee so the driver can verify they've been dropped home.
          </p>
          {pax.map((p) => {
            const status = p.noShow ? "no-show" : p.droppedAt ? "dropped" : "waiting";
            return (
              <div key={p.id} className="flex items-center gap-2 text-sm p-2 rounded border">
                <span className="font-medium">{p.seq + 1}. {p.name}</span>
                {p.dropOtp && (
                  <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded tracking-widest">
                    {p.dropOtp}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className={`ml-auto text-[10px] py-0 ${
                    status === "waiting"
                      ? ""
                      : status === "no-show"
                      ? "border-destructive/40 text-destructive"
                      : "border-success/40 text-success"
                  }`}
                >
                  {status}
                </Badge>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
