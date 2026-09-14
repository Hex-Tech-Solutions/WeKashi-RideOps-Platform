import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useDriverMe, useSetDriverVehicle,
  useUpdateDriverProfile,
} from "@/lib/queries";
import { VEHICLE_LABELS, type VehicleType } from "@/lib/pricing";
import { useDriverAuth } from "./useDriverAuth";
import { DriverCredits } from "./DriverCredits";
import { DriverUpiCard } from "./DriverUpiCard";
import {
  LogOut, Star, Building2, BadgeCheck, Phone, Car,
  AlertTriangle, Loader2,
  FileText, Save,
} from "lucide-react";
import { toast } from "sonner";

/**
 * KYC warning banner — reused across the panel sections.
 */
export function KycExpiredBanner({ kycExpired }: { kycExpired: boolean }) {
  if (!kycExpired) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
      <div>
        <div className="font-semibold text-sm text-destructive">KYC documents expired</div>
        <div className="text-xs text-destructive/80 mt-0.5">
          You're not receiving ride broadcasts. Re-upload expired documents in the Documents tab.
        </div>
      </div>
    </div>
  );
}

/**
 * Avatar + name + status header, and the phone/vendor/rating/KYC rows.
 */
export function ProfileSummaryCard({
  me,
  fullName,
}: {
  me: ReturnType<typeof useDriverMe>["data"];
  fullName?: string | null;
}) {
  const kycExpired = me?.kycStatus === "expired";
  const profileRows = [
    { Icon: Phone,      label: "Phone",       value: me?.phone ?? "—" },
    { Icon: Building2,  label: "Vendor",      value: me?.vendor?.name ?? "—" },
    { Icon: Building2,  label: "Vendor Code", value: me?.vendor?.vendorCode
        ? <span className="font-mono tracking-widest text-xs bg-secondary px-2 py-0.5 rounded select-all">{me.vendor.vendorCode}</span>
        : "—" },
    { Icon: Star,       label: "Rating",      value: me?.rating != null ? `⭐ ${me.rating.toFixed(1)}` : "—" },
    { Icon: BadgeCheck, label: "KYC",         value: me?.kycStatus ?? "—" },
  ];

  return (
    <>
      <div className="flex flex-col items-center text-center py-4">
        <div className="h-20 w-20 rounded-full bg-foreground text-background flex items-center justify-center text-2xl font-bold mb-3">
          {(fullName ?? "D").split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>
        <div className="font-semibold text-lg">{fullName ?? "Driver"}</div>
        <Badge variant="outline" className={`mt-1 capitalize ${me?.status === "active" ? "border-success/40 text-success" : "border-warning/40 text-warning"}`}>
          {me?.status ?? "—"}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-2">
          {profileRows.map((r) => (
            <div key={r.label} className="flex items-center gap-3 p-3 border-b last:border-0">
              <r.Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground flex-1">{r.label}</span>
              <span className={`text-sm font-medium capitalize ${r.label === "KYC" && kycExpired ? "text-destructive" : ""}`}>
                {r.value}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Ride Credits + Payout UPI section — replaces the old wallet/earnings block.
 * The side panel drops this into its "Ride Credits" page.
 */
export function CreditsSection() {
  return (
    <div className="space-y-4">
      <DriverCredits />
      <DriverUpiCard />
    </div>
  );
}

/**
 * Sign-out button — reused in the panel footer.
 */
export function SignOutButton() {
  const { logout } = useDriverAuth();
  return (
    <Button
      variant="outline"
      className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={() => logout()}
    >
      <LogOut className="h-4 w-4" /> Sign out
    </Button>
  );
}

export default function DriverAccount() {
  const { session } = useDriverAuth();
  const { data: me } = useDriverMe();
  const kycExpired = me?.kycStatus === "expired";

  return (
    <div className="px-4 py-4 space-y-4 pb-10">
      <KycExpiredBanner kycExpired={kycExpired} />
      <ProfileSummaryCard me={me} fullName={session?.fullName} />
      <ProfileDetailsCard me={me} />
      <VehicleCard currentType={me?.vehicleType} currentSeats={me?.seats} driverId={me?.id ?? session?.id} />
      <CreditsSection />
      <SignOutButton />
    </div>
  );
}

// ─── Personal / Licence details card ─────────────────────────────────────────

export function ProfileDetailsCard({ me }: { me: ReturnType<typeof useDriverMe>["data"] }) {
  const update = useUpdateDriverProfile();
  const [fullName,    setFullName]    = useState(me?.fullName ?? "");
  const [altPhone,    setAltPhone]    = useState(me?.altPhone ?? "");
  const [dlNumber,    setDlNumber]    = useState(me?.dlNumber ?? "");
  const [dlExpiry,    setDlExpiry]    = useState(
    me?.dlExpiry ? new Date(me.dlExpiry).toISOString().split("T")[0] : ""
  );
  const [govIdNumber, setGovIdNumber] = useState(me?.govIdNumber ?? "");

  useEffect(() => {
    if (me) {
      setFullName(me.fullName ?? "");
      setAltPhone(me.altPhone ?? "");
      setDlNumber(me.dlNumber ?? "");
      setDlExpiry(me.dlExpiry ? new Date(me.dlExpiry).toISOString().split("T")[0] : "");
      setGovIdNumber(me.govIdNumber ?? "");
    }
  }, [me]);

  const submit = () => {
    update.mutate(
      {
        fullName:    fullName.trim() || undefined,
        altPhone:    altPhone.trim() || null,
        dlNumber:    dlNumber.trim() || null,
        dlExpiry:    dlExpiry ? new Date(dlExpiry).toISOString() : null,
        govIdNumber: govIdNumber.trim() || null,
      },
      {
        onSuccess: () => toast.success("Profile updated"),
        onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
      }
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4 text-gold" /> Personal &amp; Licence Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Full Name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-9" placeholder="Full name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Phone (primary)</Label>
            <Input value={me?.phone ?? ""} disabled className="h-9 bg-muted/50 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Alternate Phone</Label>
            <Input value={altPhone} onChange={(e) => setAltPhone(e.target.value)} className="h-9" placeholder="+91 …" maxLength={15} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">DL Number</Label>
            <Input value={dlNumber} onChange={(e) => setDlNumber(e.target.value.toUpperCase())} className="h-9 font-mono" placeholder="KA1920240001234" maxLength={20} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">DL Expiry Date</Label>
            <Input type="date" value={dlExpiry} onChange={(e) => setDlExpiry(e.target.value)} className="h-9" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Gov ID Number (Aadhaar / PAN / Voter ID)</Label>
          <Input value={govIdNumber} onChange={(e) => setGovIdNumber(e.target.value)} className="h-9 font-mono" placeholder="XXXX XXXX XXXX" maxLength={30} />
        </div>
        <Button
          className="w-full bg-foreground text-background hover:bg-foreground/90"
          onClick={submit}
          disabled={update.isPending}
        >
          {update.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : <><Save className="h-3.5 w-3.5" /> Save details</>}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          These details are shared with your vendor for KYC verification. Keep them accurate.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Vehicle card ─────────────────────────────────────────────────────────────

// Remembered vehicle selection — persisted locally so the app instantly shows
// the driver's last saved vehicle on every login, before (and even if) the
// server `me` payload has loaded. The server remains the source of truth; this
// is just a fast, sticky default that survives logout/login until the driver
// changes it. Keyed by driver id so a shared device doesn't leak selections.
const VEHICLE_PREF_KEY = "rideops_driver_vehicle";

export function readVehiclePref(driverId?: string | null): { type: VehicleType; seats: string } | null {
  try {
    const raw = localStorage.getItem(VEHICLE_PREF_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (driverId && obj.driverId && obj.driverId !== driverId) return null;
    if (!obj.type) return null;
    return { type: obj.type as VehicleType, seats: String(obj.seats ?? "4") };
  } catch { return null; }
}

function writeVehiclePref(driverId: string | null | undefined, type: VehicleType, seats: string) {
  try { localStorage.setItem(VEHICLE_PREF_KEY, JSON.stringify({ driverId: driverId ?? null, type, seats })); }
  catch { /* ignore */ }
}

export function VehicleCard({ currentType, currentSeats, driverId }: { currentType?: string | null; currentSeats?: number | null; driverId?: string | null }) {
  const save = useSetDriverVehicle();
  // Seed from the server value if present, else the remembered local pref, else
  // sensible defaults — so the selection is never blank on a fresh login.
  const pref = readVehiclePref(driverId);
  const [type, setType]   = useState<VehicleType>((currentType as VehicleType) || pref?.type || "sedan");
  const [seats, setSeats] = useState<string>(currentSeats ? String(currentSeats) : pref?.seats ?? "4");

  useEffect(() => { if (currentType) setType(currentType as VehicleType); }, [currentType]);
  useEffect(() => { if (currentSeats) setSeats(String(currentSeats)); }, [currentSeats]);

  const submit = () => {
    const s = Number(seats);
    if (!(s >= 1 && s <= 20)) { toast.error("Enter valid seats (incl. driver)"); return; }
    save.mutate({ vehicleType: type, seats: s }, {
      onSuccess: () => { writeVehiclePref(driverId, type, seats); toast.success("Vehicle saved"); },
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Car className="h-4 w-4 text-gold" /> My vehicle
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["hatchback", "sedan", "suv"] as VehicleType[]).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                type === t ? "border-gold bg-gold/10 text-gold" : "border-border hover:border-gold/40"
              }`}>
              {VEHICLE_LABELS[t]}
            </button>
          ))}
        </div>
        <div>
          <Label className="text-xs">Total seats (including driver)</Label>
          <Input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 h-9" />
        </div>
        <Button className="w-full bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save vehicle"}
        </Button>
        <div className="text-[11px] text-muted-foreground">Your vehicle type decides which ride broadcasts you receive.</div>
      </CardContent>
    </Card>
  );
}
