/**
 * Vendor / admin console: driver documents expiring within 30 days or already
 * expired (#13). Click a row to open the driver and review a renewal.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useExpiringDocs } from "@/lib/queries";
import { DriverDetailDrawer } from "@/components/DriverDetailDrawer";
import { CalendarClock, Loader2 } from "lucide-react";
import { format } from "date-fns";

export const DOC_TYPE_LABELS: Record<string, string> = {
  aadhaar: "Aadhaar Card",
  dl: "Driving Licence",
  rc: "Vehicle RC",
  puc: "PUC Certificate",
  insurance: "Insurance",
  fitness_certificate: "Fitness Certificate",
  commercial_permit: "Commercial Permit",
  road_tax: "Road Tax",
  photo: "Profile Photo",
};

export function expiryText(daysLeft: number): string {
  if (daysLeft <= 0) return "Expired";
  if (daysLeft === 1) return "Expires tomorrow";
  return `Expires in ${daysLeft} days`;
}

export function ExpiringDocsCard({ showVendor = false }: { showVendor?: boolean }) {
  const { data, isLoading } = useExpiringDocs();
  const [openDriver, setOpenDriver] = useState<string | null>(null);
  const docs = data?.documents ?? [];

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-gold" /> Documents expiring
          {docs.length > 0 && <Badge variant="outline" className="ml-1">{docs.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-gold" /></div>
        ) : docs.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">No documents expire in the next 30 days.</div>
        ) : (
          <ul className="divide-y">
            {docs.map((d) => {
              const expired = d.daysLeft <= 0;
              return (
                <li key={d.documentId}>
                  <button
                    type="button"
                    onClick={() => setOpenDriver(d.driverId)}
                    className="w-full text-left py-2.5 flex items-center gap-3 text-sm hover:bg-secondary/60 rounded-md px-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {d.driver?.fullName ?? "Driver"}
                        {showVendor && d.driver?.vendor?.name && <span className="text-muted-foreground font-normal"> · {d.driver.vendor.name}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {DOC_TYPE_LABELS[d.type] ?? d.type} · {format(new Date(d.expiry), "dd MMM yyyy")}
                        {d.renewalPending && <span className="text-gold-dark font-medium"> · Renewal uploaded, review it</span>}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={expired
                        ? "border-destructive/40 text-destructive bg-destructive/10"
                        : d.daysLeft <= 7 ? "border-warning/40 text-warning" : "border-border text-muted-foreground"}
                    >
                      {expiryText(d.daysLeft)}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {docs.some((d) => d.daysLeft <= 0) && (
          <p className="text-[11px] text-muted-foreground mt-3">Drivers with an expired document get no rides until a valid copy is verified.</p>
        )}
      </CardContent>
      <DriverDetailDrawer driverId={openDriver} onClose={() => setOpenDriver(null)} />
    </Card>
  );
}
