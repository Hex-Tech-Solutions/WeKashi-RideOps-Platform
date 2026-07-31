import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useDriverMe, useSetDriverVehicle, useDriverWallet,
  useDriverBankDetail, useSaveDriverBankDetail,
  useOnboardingStatus, useStartOnboarding, useSubmitBankForOnboarding,
  useUpdateDriverProfile,
} from "@/lib/queries";
import { VEHICLE_LABELS, type VehicleType } from "@/lib/pricing";
import { useDriverAuth } from "./useDriverAuth";
import {
  LogOut, Star, Building2, BadgeCheck, Phone, Car, Wallet,
  AlertTriangle, IndianRupee, CheckCircle2, Pencil, X, Check, Loader2,
  CreditCard, FileText, Save,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function DriverAccount() {
  const { session, logout } = useDriverAuth();
  const { data: me }         = useDriverMe();
  const { data: walletData } = useDriverWallet();

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
    <div className="px-4 py-4 space-y-4 pb-10">
      {/* KYC expired warning */}
      {kycExpired && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-sm text-destructive">KYC documents expired</div>
            <div className="text-xs text-destructive/80 mt-0.5">
              You're not receiving ride broadcasts. Re-upload expired documents in the Documents tab.
            </div>
          </div>
        </div>
      )}

      {/* Avatar + name */}
      <div className="flex flex-col items-center text-center py-4">
        <div className="h-20 w-20 rounded-full bg-foreground text-background flex items-center justify-center text-2xl font-bold mb-3">
          {(session?.fullName ?? "D").split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>
        <div className="font-semibold text-lg">{session?.fullName ?? "Driver"}</div>
        <Badge variant="outline" className={`mt-1 capitalize ${me?.status === "active" ? "border-success/40 text-success" : "border-warning/40 text-warning"}`}>
          {me?.status ?? "—"}
        </Badge>
      </div>

      {/* Profile rows */}
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

      {/* Personal details (DL, Gov ID, alt phone) */}
      <ProfileDetailsCard me={me} />

      {/* Vehicle */}
      <VehicleCard currentType={me?.vehicleType} currentSeats={me?.seats} />

      {/* Wallet */}
      <WalletCard
        balance={walletData?.walletBalance ?? me?.walletBalance ?? 0}
        payments={walletData?.payments ?? []}
      />

      <Button
        variant="outline"
        className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => logout()}
      >
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </div>
  );
}

// ─── Personal / Licence details card ─────────────────────────────────────────

function ProfileDetailsCard({ me }: { me: ReturnType<typeof useDriverMe>["data"] }) {
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

// ─── Wallet card ──────────────────────────────────────────────────────────────

function WalletCard({
  balance,
  payments,
}: {
  balance: number;
  payments: Array<{
    id: string; price: number | null; platformFee?: number | null;
    paidAt: string | null; pickupAddress: string; dropAddress: string;
    supervisor: { fullName: string; org: string | null } | null;
  }>;
}) {
  const { data: bankData } = useDriverBankDetail();
  const bankDetail = bankData?.bankDetail;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gold" /> Earnings & Wallet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Balance display */}
        <div className="rounded-xl border-2 border-gold/30 bg-gold/5 p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Available balance</div>
          <div className="text-4xl font-bold flex items-center gap-1">
            <IndianRupee className="h-7 w-7" />
            {balance.toLocaleString()}
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">
            This is your total earnings from completed rides.
          </div>
        </div>

        {/* Bank/UPI setup */}
        <RouteOnboardingSection />

        <Separator />

        {/* Payment history */}
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Payment history ({payments.length})
          </div>
          {payments.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6 border-2 border-dashed rounded-lg">
              No payments received yet. Complete rides to start earning.
            </div>
          ) : (
            <ScrollArea className="max-h-72">
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card text-xs">
                    <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.pickupAddress}</div>
                      <div className="text-muted-foreground truncate">→ {p.dropAddress}</div>
                      <div className="text-muted-foreground mt-0.5">
                        {p.supervisor?.org ?? p.supervisor?.fullName ?? "Supervisor"}
                        {p.paidAt && ` · ${format(new Date(p.paidAt), "dd MMM, HH:mm")}`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-success text-sm flex items-center gap-0.5">
                        +<IndianRupee className="h-3 w-3" />{p.price?.toLocaleString() ?? "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Your earnings</div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Razorpay Route onboarding wizard ────────────────────────────────────────

function RouteOnboardingSection() {
  const { data: statusData, isLoading } = useOnboardingStatus();
  const startOnboarding  = useStartOnboarding();
  const submitBank       = useSubmitBankForOnboarding();

  const [tab, setTab]             = useState<"upi" | "bank">("upi");
  const [upiId, setUpiId]         = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [ifsc, setIfsc]           = useState("");
  const [accountName, setAccountName] = useState("");

  const step = statusData?.step ?? "not_started";
  const verified = statusData?.verified ?? false;

  const handleStart = () => {
    startOnboarding.mutate(undefined, {
      onError: (e: any) => toast.error(e?.message ?? "Failed to start onboarding"),
    });
  };

  const handleSubmitBank = () => {
    const payload = tab === "upi"
      ? { upiId: upiId.trim() }
      : { accountNo: accountNo.trim(), ifsc: ifsc.trim().toUpperCase(), accountName: accountName.trim() };
    submitBank.mutate(payload as any, {
      onSuccess: () => toast.success("Details submitted — verification in progress"),
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Payout setup
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[
          { label: "Create account", done: step !== "not_started" },
          { label: "Add bank/UPI",   done: step === "pending_verification" || verified },
          { label: "Verified",        done: verified },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-1">
            <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
              s.done ? "bg-success text-white" : "bg-muted text-muted-foreground"
            }`}>
              {s.done ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span className={`text-[10px] ${s.done ? "text-success font-medium" : "text-muted-foreground"}`}>
              {s.label}
            </span>
            {i < 2 && <div className="flex-1 h-px bg-border" />}
          </div>
        ))}
      </div>

      {isLoading && <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}

      {/* Step 1: not started */}
      {!isLoading && step === "not_started" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Set up your Razorpay payout account to receive payments directly when supervisors pay for rides.
          </p>
          <Button
            className="w-full bg-foreground text-background hover:bg-foreground/90"
            onClick={handleStart}
            disabled={startOnboarding.isPending}
          >
            {startOnboarding.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Setting up…</>
              : "Set up payout account"
            }
          </Button>
        </div>
      )}

      {/* Step 2: account created, need bank/UPI */}
      {!isLoading && step === "not_started" === false && !verified && step !== "pending_verification" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Add your UPI ID or bank account to receive payments.</p>
          <div className="flex rounded-lg border p-1 bg-muted/40 gap-1">
            {(["upi", "bank"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
                }`}>
                {t === "upi" ? "UPI ID" : "Bank Account"}
              </button>
            ))}
          </div>
          {tab === "upi" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">UPI ID</Label>
              <Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="name@upi or 9876543210@ybl" className="h-9 font-mono text-sm" />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="space-y-1"><Label className="text-xs">Account holder name</Label><Input value={accountName} onChange={(e) => setAccountName(e.target.value)} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Account number</Label><Input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} className="h-9 font-mono" /></div>
              <div className="space-y-1"><Label className="text-xs">IFSC code</Label><Input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} className="h-9 font-mono" maxLength={11} /></div>
            </div>
          )}
          <Button className="w-full bg-foreground text-background hover:bg-foreground/90" onClick={handleSubmitBank} disabled={submitBank.isPending}>
            {submitBank.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting…</> : <><Check className="h-3.5 w-3.5" /> Submit for verification</>}
          </Button>
        </div>
      )}

      {/* Step 2b: pending verification */}
      {!isLoading && step === "pending_verification" && (
        <div className="rounded-md border bg-warning/5 border-warning/30 p-3 text-xs text-warning flex items-start gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 mt-0.5 animate-spin" />
          <div>
            <div className="font-semibold">Verification in progress</div>
            <div className="text-muted-foreground mt-0.5">Razorpay is verifying your bank/UPI details. This usually takes a few minutes.</div>
          </div>
        </div>
      )}

      {/* Complete */}
      {!isLoading && verified && (
        <div className="rounded-md border bg-success/5 border-success/30 p-3 text-xs text-success flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Payout account verified</div>
            <div className="text-muted-foreground mt-0.5">Payments from supervisors will be automatically transferred to your account.</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vehicle card ─────────────────────────────────────────────────────────────

function VehicleCard({ currentType, currentSeats }: { currentType?: string | null; currentSeats?: number | null }) {
  const save = useSetDriverVehicle();
  const [type, setType]   = useState<VehicleType>((currentType as VehicleType) || "sedan");
  const [seats, setSeats] = useState<string>(currentSeats ? String(currentSeats) : "4");

  useEffect(() => { if (currentType) setType(currentType as VehicleType); }, [currentType]);
  useEffect(() => { if (currentSeats) setSeats(String(currentSeats)); }, [currentSeats]);

  const submit = () => {
    const s = Number(seats);
    if (!(s >= 1 && s <= 20)) { toast.error("Enter valid seats (incl. driver)"); return; }
    save.mutate({ vehicleType: type, seats: s }, {
      onSuccess: () => toast.success("Vehicle saved"),
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
