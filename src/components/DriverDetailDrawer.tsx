/**
 * DriverDetailDrawer
 *
 * Full-detail slide-over panel for vendor and admin consoles.
 * Shows:
 *   - Personal info: name, phone, alt phone, DL number/expiry, Gov ID
 *   - Vehicle info
 *   - All documents with status + approve / reject (with note) actions
 *   - KYC overall status badge
 *
 * Props:
 *   driverId     — ID of the driver to show (null = drawer closed)
 *   onClose      — called when user closes the drawer
 *   canApprove   — whether the viewer can approve/reject docs (vendor/admin)
 */

import { useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useDriver, useDriverDocsForVendor, useSetDocumentStatus, fileSrc,
  type DocumentRow,
} from "@/lib/queries";
import {
  Loader2, Phone, Car, Building2, CreditCard, FileText,
  CheckCircle2, XCircle, Clock, AlertTriangle, ExternalLink,
  User, BadgeCheck,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

// ─── Document type labels ─────────────────────────────────────────────────────

const DOC_LABELS: Record<string, string> = {
  aadhaar:             "Aadhaar Card",
  dl:                  "Driving Licence",
  rc:                  "Vehicle RC",
  puc:                 "PUC Certificate",
  insurance:           "Insurance",
  fitness_certificate: "Fitness Certificate",
  commercial_permit:   "Commercial Permit",
  road_tax:            "Road Tax",
  photo:               "Profile Photo",
};

// Ordered for display
const DOC_ORDER = [
  "photo", "aadhaar", "dl", "rc", "puc",
  "insurance", "fitness_certificate", "commercial_permit", "road_tax",
];

function docLabel(type: string) {
  return DOC_LABELS[type] ?? type;
}

function isExpired(doc: DocumentRow) {
  return !!doc.expiry && new Date(doc.expiry) < new Date();
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

export function DriverDetailDrawer({
  driverId,
  onClose,
  canApprove = true,
}: {
  driverId: string | null;
  onClose: () => void;
  canApprove?: boolean;
}) {
  const { data: driver, isLoading: driverLoading } = useDriver(driverId);
  const { data: docsData, isLoading: docsLoading }  = useDriverDocsForVendor(driverId);
  const docs = docsData?.documents ?? [];

  const kycVariant = (s?: string) => {
    if (s === "approved")  return "border-success/40 text-success bg-success/10";
    if (s === "rejected")  return "border-destructive/40 text-destructive bg-destructive/10";
    if (s === "expired")   return "border-destructive/40 text-destructive bg-destructive/10";
    return "border-warning/40 text-warning bg-warning/10";
  };

  // Sort docs in display order; unknowns go to end
  const sortedDocs = [...docs].sort((a, b) => {
    const ia = DOC_ORDER.indexOf(a.type);
    const ib = DOC_ORDER.indexOf(b.type);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const pendingCount = docs.filter((d) => d.status === "pending").length;

  return (
    <Sheet open={!!driverId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          {driverLoading ? (
            <SheetTitle className="flex items-center gap-2 text-base">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> Loading driver…
            </SheetTitle>
          ) : driver ? (
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-full bg-foreground text-background flex items-center justify-center text-sm font-bold shrink-0">
                {driver.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-base leading-tight">{driver.fullName}</SheetTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="outline" className={kycVariant(driver.kycStatus)}>
                    <BadgeCheck className="h-3 w-3 mr-1" /> KYC: {driver.kycStatus}
                  </Badge>
                  <Badge variant="outline" className={kycVariant(driver.status)}>
                    {driver.status}
                  </Badge>
                  {pendingCount > 0 && (
                    <Badge className="bg-warning text-warning-foreground">
                      {pendingCount} pending
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <SheetTitle className="text-base text-destructive">Driver not found</SheetTitle>
          )}
        </SheetHeader>

        {/* Scrollable body */}
        <ScrollArea className="flex-1">
          {driver && (
            <div className="px-6 py-4 space-y-6">
              {/* Personal info */}
              <section>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                  Personal Details
                </div>
                <div className="space-y-2 text-sm">
                  <InfoRow icon={User}       label="Full Name"        value={driver.fullName} />
                  <InfoRow icon={Phone}       label="Phone"            value={driver.phone} />
                  <InfoRow icon={Phone}       label="Alt. Phone"       value={driver.altPhone ?? "—"} />
                  <InfoRow icon={Building2}   label="Vendor"           value={driver.vendor?.name ?? "—"} />
                  <InfoRow icon={CreditCard}  label="DL Number"        value={driver.dlNumber ?? "—"} mono />
                  <InfoRow icon={CreditCard}  label="DL Expiry"        value={driver.dlExpiry ? format(new Date(driver.dlExpiry), "dd MMM yyyy") : "—"} />
                  <InfoRow icon={FileText}    label="Gov ID Number"    value={driver.govIdNumber ?? "—"} mono />
                </div>
              </section>

              <Separator />

              {/* Vehicle */}
              <section>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                  Vehicle
                </div>
                {driver.vehicle ? (
                  <div className="space-y-2 text-sm">
                    <InfoRow icon={Car} label="Reg No"      value={driver.vehicle.regNo} mono />
                    <InfoRow icon={Car} label="Fuel Type"   value={driver.vehicle.fuelType} />
                    <InfoRow icon={Car} label="Capacity"    value={`${driver.vehicle.capacity} seats`} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No vehicle assigned.</p>
                )}
              </section>

              <Separator />

              {/* Documents */}
              <section>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3 flex items-center gap-2">
                  KYC &amp; Vehicle Documents
                  {docsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                {sortedDocs.length === 0 && !docsLoading && (
                  <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
                )}
                <div className="space-y-3">
                  {sortedDocs.map((doc) => (
                    <DocReviewCard
                      key={doc.id}
                      doc={doc}
                      driverId={driver.id}
                      canApprove={canApprove}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <span className={`font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

// ─── Document review card ─────────────────────────────────────────────────────

function DocReviewCard({
  doc,
  driverId,
  canApprove,
}: {
  doc: DocumentRow;
  driverId: string;
  canApprove: boolean;
}) {
  const setStatus  = useSetDocumentStatus();
  const [note, setNote]       = useState("");
  const [showNote, setShowNote] = useState(false);

  const expired  = isExpired(doc);
  const pending  = doc.status === "pending";
  const rejected = doc.status === "rejected";
  const verified = doc.status === "verified";

  const approve = () => {
    setStatus.mutate({ driverId, docId: doc.id, status: "verified" }, {
      onSuccess: () => toast.success(`${docLabel(doc.type)} approved`),
      onError:  (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  const reject = () => {
    setStatus.mutate({ driverId, docId: doc.id, status: "rejected", rejectionNote: note.trim() || undefined }, {
      onSuccess: () => { toast.error(`${docLabel(doc.type)} rejected`); setShowNote(false); setNote(""); },
      onError:  (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  const statusCls = expired
    ? "border-destructive/40 bg-destructive/5"
    : verified
    ? "border-success/40 bg-success/5"
    : rejected
    ? "border-destructive/40 bg-destructive/5"
    : "border-warning/40 bg-warning/5";

  const StatusIcon = expired ? AlertTriangle
    : verified ? CheckCircle2
    : rejected  ? XCircle
    : Clock;

  const statusLabel = expired ? "expired" : doc.status;

  const statusBadgeCls = expired
    ? "border-destructive/40 text-destructive"
    : verified
    ? "border-success/40 text-success"
    : rejected
    ? "border-destructive/40 text-destructive"
    : "border-warning/40 text-warning";

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${statusCls}`}>
      {/* Top row */}
      <div className="flex items-start gap-2">
        <StatusIcon className={`h-4 w-4 mt-0.5 shrink-0 ${
          expired || rejected ? "text-destructive" : verified ? "text-success" : "text-warning"
        }`} />
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="font-medium text-sm">{docLabel(doc.type)}</div>
          {doc.number && <div className="text-xs text-muted-foreground font-mono">#{doc.number}</div>}
          {doc.expiry && (
            <div className={`text-xs ${expired ? "text-destructive font-medium" : "text-muted-foreground"}`}>
              Expiry: {format(new Date(doc.expiry), "dd MMM yyyy")}
              {expired && " · EXPIRED"}
            </div>
          )}
          {rejected && doc.rejectionNote && (
            <div className="text-xs text-destructive">Reason: {doc.rejectionNote}</div>
          )}
          {verified && doc.reviewedBy && (
            <div className="text-xs text-muted-foreground">
              Verified by {doc.reviewedBy}
              {doc.reviewedAt && ` · ${format(new Date(doc.reviewedAt), "dd MMM")}`}
            </div>
          )}
        </div>
        <Badge variant="outline" className={`${statusBadgeCls} capitalize shrink-0 text-[10px]`}>
          {statusLabel}
        </Badge>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className="flex-1 h-8 text-xs">
          <a href={fileSrc(doc.fileUrl)} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3 w-3 mr-1" /> View
          </a>
        </Button>
        {canApprove && !verified && (
          <Button
            size="sm"
            className="flex-1 h-8 text-xs bg-success text-white hover:bg-success/90"
            onClick={approve}
            disabled={setStatus.isPending}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
          </Button>
        )}
        {canApprove && !rejected && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setShowNote((s) => !s)}
            disabled={setStatus.isPending}
          >
            <XCircle className="h-3 w-3 mr-1" /> Reject
          </Button>
        )}
        {canApprove && rejected && (
          <Button
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={approve}
            disabled={setStatus.isPending}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> Re-approve
          </Button>
        )}
      </div>

      {/* Rejection note input */}
      {showNote && (
        <div className="space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for rejection (optional but helpful for the driver)"
            className="text-xs h-16 resize-none"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => setShowNote(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 h-8 text-xs bg-destructive text-white hover:bg-destructive/90"
              onClick={reject}
              disabled={setStatus.isPending}
            >
              {setStatus.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm Reject"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
