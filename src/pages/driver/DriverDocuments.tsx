import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDriverMe,
  useDriverDocuments,
  useUploadDriverDocument,
  useDeleteDriverDocument,
  type DocumentRow,
  type ProfileItem,
  PROFILE_ITEM_LABELS,
} from "@/lib/queries";
import { DocumentViewer } from "@/components/DocumentViewer";
import { JoiningBonusBanner, KycBlockedBanner, DocExpiryBanner } from "./DriverAccount";
import { format, subDays } from "date-fns";
import {
  FileText,
  Upload,
  Camera,
  Trash2,
  Eye,
  Lock,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  isCameraAvailable, takePhoto, CameraError,
  takeRestoredPhoto, onRestoredPhoto, clearPendingCapture,
} from "@/lib/nativeCamera";
import { openAppSettings } from "@/lib/deviceLocation";

// Must match RENEWAL_WINDOW_DAYS in backend/src/lib/documentTypes.ts.
const RENEWAL_WINDOW_DAYS = 30;

const REQUIRED = [
  { type: "aadhaar",              label: "Aadhaar Card",             wantsNumber: true },
  { type: "dl",                   label: "Driving Licence",          wantsNumber: true,  wantsExpiry: true },
  { type: "rc",                   label: "Vehicle RC",               wantsNumber: true },
  { type: "puc",                  label: "PUC Certificate",                               wantsExpiry: true },
  { type: "insurance",            label: "Insurance",                                      wantsExpiry: true },
  { type: "fitness_certificate",  label: "Fitness Certificate",      wantsNumber: true,  wantsExpiry: true },
  { type: "commercial_permit",    label: "Commercial Permit",        wantsNumber: true,  wantsExpiry: true },
  { type: "road_tax",             label: "Road Tax",                 wantsNumber: true,  wantsExpiry: true },
  { type: "photo",                label: "Profile Photo" },
];

// Doc-type label lookup for the banner message
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

function isDocExpired(doc: DocumentRow): boolean {
  return !!doc.expiry && new Date(doc.expiry) < new Date();
}

const statusBadge = (doc: DocumentRow) => {
  if (isDocExpired(doc)) {
    return { cls: "border-destructive/40 text-destructive bg-destructive/10", Icon: AlertTriangle, label: "expired" };
  }
  if (doc.status === "verified")  return { cls: "border-success/40 text-success",              Icon: CheckCircle2, label: "verified"  };
  if (doc.status === "rejected")  return { cls: "border-destructive/40 text-destructive",       Icon: XCircle,      label: "rejected"  };
  return                                 { cls: "border-warning/40 text-warning",               Icon: Clock,        label: "pending"   };
};

export default function DriverDocuments({ onOpenAccount }: { onOpenAccount?: (section: "profile" | "vehicle" | "credits") => void } = {}) {
  const { data: meData }  = useDriverMe();
  const profileMissing = meData?.profileMissing ?? [];
  const { data, isLoading } = useDriverDocuments();
  const docs    = data?.documents ?? [];
  const byType  = (t: string) => docs.find((d) => d.type === t);

  // Expired doc types from the server (cross-checks DB, not just client-side date)
  const serverExpired = meData?.expiredDocTypes ?? [];

  // KYC-suspended banner: show when kycStatus is 'expired'
  const kycExpired = meData?.kycStatus === "expired";

  useRestoredPhotoUpload();

  return (
    <div className="px-4 py-4 space-y-3">
      <JoiningBonusBanner me={meData} onDocumentsTab />
      {/* Rejected KYC (expired has its own banner below) */}
      {meData?.kycStatus === "rejected" && <KycBlockedBanner me={meData} onDocumentsTab />}
      <DocExpiryBanner me={meData} onDocumentsTab />
      {/* ── KYC suspended banner ── */}
      {kycExpired && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div className="font-semibold text-sm text-destructive">KYC suspended — rides blocked</div>
            <div className="text-xs text-destructive/80">
              One or more of your documents have expired. You will not receive ride broadcasts until
              you re-upload the documents below and your vendor re-verifies them.
            </div>
            {serverExpired.length > 0 && (
              <div className="text-xs text-destructive/80 font-medium mt-1">
                Expired: {serverExpired.map((t) => DOC_LABELS[t] ?? t).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}

      {profileMissing.length > 0 ? (
        <ProfileGate missing={profileMissing} onOpenAccount={onOpenAccount} />
      ) : (
      <>
      <div className="text-sm text-muted-foreground">
        Upload your KYC &amp; vehicle documents. Your vendor verifies them before you go active.
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-gold" />
        </div>
      ) : (
        REQUIRED.map((req) => (
          <DocCard
            key={req.type}
            req={req}
            existing={byType(req.type)}
            serverExpired={serverExpired.includes(req.type)}
          />
        ))
      )}
      </>
      )}
    </div>
  );
}

const VEHICLE_ITEMS: ProfileItem[] = ["vehicleNo", "vehicleType", "seats", "fuelType"];
// The payout UPI card lives under Account → Ride Credits.
const UPI_ITEMS: ProfileItem[] = ["upiId"];

/** #9: documents unlock once personal, licence, UPI and vehicle details are saved. */
function ProfileGate({ missing, onOpenAccount }: { missing: ProfileItem[]; onOpenAccount?: (s: "profile" | "vehicle" | "credits") => void }) {
  const profileItems = missing.filter((m) => !VEHICLE_ITEMS.includes(m) && !UPI_ITEMS.includes(m));
  const vehicleItems = missing.filter((m) => VEHICLE_ITEMS.includes(m));
  const upiItems = missing.filter((m) => UPI_ITEMS.includes(m));
  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Lock className="h-5 w-5 text-warning mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-semibold text-sm">Complete your profile to upload documents</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Fill in these details first. Your documents are checked against them.
            </div>
          </div>
        </div>
        {profileItems.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium">Account → Profile</div>
            <ul className="text-xs text-muted-foreground list-disc pl-5">
              {profileItems.map((m) => <li key={m}>{PROFILE_ITEM_LABELS[m]}</li>)}
            </ul>
            {onOpenAccount && (
              <Button size="sm" variant="outline" className="w-full" onClick={() => onOpenAccount("profile")}>Open Profile</Button>
            )}
          </div>
        )}
        {upiItems.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium">Account → Ride Credits → Payout UPI</div>
            <ul className="text-xs text-muted-foreground list-disc pl-5">
              {upiItems.map((m) => <li key={m}>{PROFILE_ITEM_LABELS[m]}</li>)}
            </ul>
            {onOpenAccount && (
              <Button size="sm" variant="outline" className="w-full" onClick={() => onOpenAccount("credits")}>Add UPI ID</Button>
            )}
          </div>
        )}
        {vehicleItems.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium">Account → Vehicle info</div>
            <ul className="text-xs text-muted-foreground list-disc pl-5">
              {vehicleItems.map((m) => <li key={m}>{PROFILE_ITEM_LABELS[m]}</li>)}
            </ul>
            {onOpenAccount && (
              <Button size="sm" variant="outline" className="w-full" onClick={() => onOpenAccount("vehicle")}>Open Vehicle info</Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Finish an upload whose photo arrived after Android restarted the app while
 * the camera was open (see src/lib/nativeCamera.ts).
 */
function useRestoredPhotoUpload() {
  const upload = useUploadDriverDocument();
  const mutate = upload.mutate;
  useEffect(() => {
    const run = () => {
      const r = takeRestoredPhoto();
      if (!r) return;
      clearPendingCapture();
      const { pending, file } = r;
      const label = DOC_LABELS[pending.docType] ?? "Document";
      const form = new FormData();
      form.append("file", file);
      form.append("type", pending.docType);
      if (pending.number) form.append("number", pending.number);
      if (pending.expiry) form.append("expiry", new Date(pending.expiry).toISOString());
      const t = toast.loading(`Uploading ${label}…`);
      mutate(form, {
        onSuccess: () => toast.success(`${label} uploaded`, { id: t }),
        onError: (e: any) => toast.error(e?.message ?? "Upload failed", { id: t }),
      });
    };
    run();
    return onRestoredPhoto(run);
  }, [mutate]);
}

function DocCard({
  req,
  existing,
  serverExpired,
}: {
  req: { type: string; label: string; wantsNumber?: boolean; wantsExpiry?: boolean };
  existing?: DocumentRow;
  serverExpired: boolean;
}) {
  const upload = useUploadDriverDocument();
  const del    = useDeleteDriverDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [viewing, setViewing] = useState(false);
  // For an existing document, the number/expiry inputs appear once the driver
  // taps Replace / Re-upload, so a replacement always carries fresh details.
  const [replacing, setReplacing] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  // Required details for this type must be filled before picking a file.
  const detailsError = (): string | null => {
    if (req.wantsNumber && !number.trim()) return `Enter the ${req.label} number`;
    if (req.wantsExpiry) {
      if (!expiry) return `Enter the ${req.label} expiry date`;
      if (expiry < today) return `${req.label} has already expired — upload a valid document`;
    }
    return null;
  };

  const pickFile = () => {
    const err = detailsError();
    if (err) { toast.error(err); return; }
    fileRef.current?.click();
  };

  const cameraOn = isCameraAvailable();
  const [shooting, setShooting] = useState(false);
  const snap = async () => {
    const err = detailsError();
    if (err) { toast.error(err); return; }
    setShooting(true);
    try {
      const file = await takePhoto({
        name: req.type,
        front: req.type === "photo",
        pending: {
          docType: req.type,
          number: req.wantsNumber ? number.trim() : undefined,
          expiry: req.wantsExpiry ? expiry : undefined,
        },
      });
      if (file) onFile(file);
    } catch (e) {
      if (e instanceof CameraError && e.kind === "denied") {
        toast.error("Camera permission is off", {
          action: { label: "Settings", onClick: () => { void openAppSettings(); } },
        });
      } else {
        toast.error("Could not take the photo. Try again or upload a file.");
      }
    } finally {
      setShooting(false);
    }
  };

  const onFile = (file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("type", req.type);
    if (req.wantsNumber) form.append("number", number.trim());
    if (req.wantsExpiry) form.append("expiry", new Date(expiry).toISOString());
    upload.mutate(form, {
      onSuccess: () => {
        toast.success(`${req.label} uploaded`);
        setReplacing(false);
        setNumber("");
        setExpiry("");
      },
      onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
    });
    // Allow picking the same file again after an error.
    if (fileRef.current) fileRef.current.value = "";
  };

  const needsDetails = !!(req.wantsNumber || req.wantsExpiry);
  const showDetailInputs = needsDetails && (!existing || replacing);

  // Same rule as the server (backend/src/lib/documentTypes.ts):
  //   pending  -> replace or delete (not reviewed yet)
  //   rejected -> re-upload (the vendor asked for a new one), no delete
  //   verified -> locked; replace only within RENEWAL_WINDOW_DAYS of expiry
  const status = existing?.status;
  const renewalDue =
    !!existing?.expiry &&
    new Date(existing.expiry).getTime() - Date.now() <= RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const canReplace = !existing || status !== "verified" || renewalDue;
  const canDelete = status === "pending";
  const locked = status === "verified" && !renewalDue;

  const detailInputs = (
    <div className="grid grid-cols-2 gap-2">
      {req.wantsNumber && (
        <Input
          placeholder={`${req.label} number`}
          aria-label={`${req.label} number`}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="h-9 text-sm"
          required
        />
      )}
      {req.wantsExpiry && (
        <Input
          type="date"
          aria-label={`${req.label} expiry date`}
          min={today}
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="h-9 text-sm"
          required
        />
      )}
    </div>
  );

  // Determine expired state: prefer client-side date check; fall back to server flag.
  const clientExpired = existing ? isDocExpired(existing) : false;
  const docExpired    = clientExpired || serverExpired;

  const badge = existing ? statusBadge(existing) : null;

  return (
    <Card className={docExpired ? "border-destructive/40" : undefined}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
            docExpired ? "bg-destructive/10" : "bg-secondary"
          }`}>
            {docExpired
              ? <AlertTriangle className="h-4 w-4 text-destructive" />
              : <FileText className="h-4 w-4 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm flex items-center gap-2">
              {req.label}
              {docExpired && (
                <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide">
                  Expired — re-upload required
                </span>
              )}
            </div>
            {existing?.number && (
              <div className="text-xs text-muted-foreground">#{existing.number}</div>
            )}
            {existing?.expiry && (
              <div className={`text-xs ${docExpired ? "text-destructive" : "text-muted-foreground"}`}>
                Expiry: {new Date(existing.expiry).toLocaleDateString()}
              </div>
            )}
            {existing?.status === "rejected" && existing.rejectionNote && (
              <div className="text-xs text-destructive mt-0.5 flex items-start gap-1">
                <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>Rejected: {existing.rejectionNote}</span>
              </div>
            )}
          </div>
          {badge && (
            <Badge variant="outline" className={`${badge.cls} gap-1 shrink-0`}>
              <badge.Icon className="h-3 w-3" />
              {badge.label}
            </Badge>
          )}
        </div>

        {existing ? (
          <div className="space-y-2">
          {showDetailInputs && detailInputs}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setViewing(true)}>
              <Eye className="h-3.5 w-3.5" /> View
            </Button>
            {canReplace && (
              <Button
                variant={docExpired || renewalDue || status === "rejected" ? "default" : "outline"}
                size="sm"
                className={`flex-1 ${docExpired || renewalDue || status === "rejected" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}`}
                onClick={() => (needsDetails && !replacing ? setReplacing(true) : pickFile())}
                disabled={upload.isPending}
              >
                {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {replacing
                  ? "Choose file"
                  : status === "verified" ? "Renew"
                  : status === "rejected" ? "Re-upload"
                  : "Replace"}
              </Button>
            )}
            {canReplace && cameraOn && (replacing || !needsDetails) && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Take photo of ${req.label}`}
                disabled={upload.isPending || shooting}
                onClick={snap}
              >
                {shooting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Withdraw ${req.label}`}
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(existing.id, {
                    onSuccess: () => toast.success("Removed"),
                    onError: (e: any) => toast.error(e?.message ?? "Failed"),
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {locked && (
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" />
              Verified and locked.
              {existing.expiry
                ? ` You can renew it from ${format(subDays(new Date(existing.expiry), RENEWAL_WINDOW_DAYS), "dd MMM yyyy")}.`
                : " Contact your vendor if it needs to change."}
            </p>
          )}
          {renewalDue && status === "verified" && !docExpired && (
            <p className="text-xs text-destructive">Expiring soon — upload the renewed document.</p>
          )}
          {replacing && (
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setReplacing(false)}>
              Cancel
            </button>
          )}
          </div>
        ) : (
          <div className="space-y-2">
            {showDetailInputs && detailInputs}
            <div className={cameraOn ? "grid grid-cols-2 gap-2" : undefined}>
              {cameraOn && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={snap}
                  disabled={upload.isPending || shooting}
                >
                  {shooting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <><Camera className="h-3.5 w-3.5" /> Take photo</>}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={pickFile}
                disabled={upload.isPending}
              >
                {upload.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <><Upload className="h-3.5 w-3.5" /> {cameraOn ? "Upload file" : `Upload ${req.label}`}</>}
              </Button>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />

        <DocumentViewer
          fileUrl={viewing && existing ? existing.fileUrl : null}
          title={req.label}
          onClose={() => setViewing(false)}
        />
      </CardContent>
    </Card>
  );
}
