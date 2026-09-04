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
  useWithdraw, useDriverPayouts,
  useUpdateDriverProfile,
  type PayoutTransaction,
} from "@/lib/queries";
import { VEHICLE_LABELS, type VehicleType } from "@/lib/pricing";
import { useDriverAuth } from "./useDriverAuth";
import {
  LogOut, Star, Building2, BadgeCheck, Phone, Car, Wallet,
  AlertTriangle, IndianRupee, CheckCircle2, Check, Loader2,
  CreditCard, FileText, Save, ArrowDownToLine, Clock, XCircle,
} from "lucide-react";
import { format } from "date-fns";
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
 * Wallet + earnings section, composed so the side panel can drop it into its
 * "Wallet & Ride Earnings" page. Fetches its own wallet data.
 */
export function WalletSection() {
  const { data: me }         = useDriverMe();
  const { data: walletData } = useDriverWallet();
  return (
    <WalletCard
      balance={walletData?.walletBalance ?? me?.walletBalance ?? 0}
      maxWithdrawable={walletData?.maxWithdrawable ?? 0}
      payoutFee={walletData?.payoutFee ?? 5.90}
      payments={walletData?.payments ?? []}
    />
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
      <WalletSection />
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

// ─── Wallet card ──────────────────────────────────────────────────────────────

export function WalletCard({
  balance,
  maxWithdrawable,
  payoutFee,
  payments,
}: {
  balance: number;
  maxWithdrawable: number;
  payoutFee: number;
  payments: Array<{
    id: string; price: number | null; escortCharge?: number | null; platformFee?: number | null;
    paidAt: string | null; pickupAddress: string; dropAddress: string;
    supervisor: { fullName: string; org: string | null } | null;
  }>;
}) {
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
            {balance.toFixed(2)}
          </div>
          {maxWithdrawable > 0 && (
            <div className="text-[11px] text-muted-foreground mt-1">
              Max withdrawable: ₹{maxWithdrawable.toFixed(2)} (after ₹{payoutFee} fee)
            </div>
          )}
        </div>

        {/* Withdraw section */}
        <WithdrawSection balance={balance} maxWithdrawable={maxWithdrawable} payoutFee={payoutFee} />

        <Separator />

        {/* Payout history */}
        <PayoutHistory />

        <Separator />

        {/* Ride earnings history */}
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Ride earnings ({payments.length})
          </div>
          {payments.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6 border-2 border-dashed rounded-lg">
              No payments received yet. Complete rides to start earning.
            </div>
          ) : (
            <ScrollArea className="max-h-56">
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
                        +<IndianRupee className="h-3 w-3" />{((p.price ?? 0) + (p.escortCharge ?? 0)).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.escortCharge ? `Fare ₹${p.price} + escort ₹${p.escortCharge}` : "Credited to wallet"}
                      </div>
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

// ─── Withdraw section ─────────────────────────────────────────────────────────

function WithdrawSection({
  balance,
  maxWithdrawable,
  payoutFee,
}: {
  balance: number;
  maxWithdrawable: number;
  payoutFee: number;
}) {
  const { data: bankData }    = useDriverBankDetail();
  const saveBankDetail        = useSaveDriverBankDetail();
  const withdraw              = useWithdraw();
  const [amount, setAmount]   = useState("");
  const [tab, setTab]         = useState<"upi" | "bank">("upi");
  const [upiId, setUpiId]     = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [ifsc, setIfsc]       = useState("");
  const [accountName, setAccountName] = useState("");
  const [editingBank, setEditingBank] = useState(false);

  const bankDetail = bankData?.bankDetail;
  const hasBankDetail = bankDetail && (bankDetail.upiId || bankDetail.accountNo);

  const handleSaveBank = () => {
    const payload = tab === "upi"
      ? { upiId: upiId.trim() }
      : { accountNo: accountNo.trim(), ifsc: ifsc.trim().toUpperCase(), accountName: accountName.trim() };
    saveBankDetail.mutate(payload as any, {
      onSuccess: () => { toast.success("Bank details saved"); setEditingBank(false); },
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  const handleWithdraw = () => {
    const amt = parseFloat(amount);
    if (!amt || amt < 1) { toast.error("Enter a valid amount (minimum ₹1)"); return; }
    if (amt > maxWithdrawable) {
      toast.error(`Max withdrawable is ₹${maxWithdrawable.toFixed(2)} (including ₹${payoutFee} fee)`);
      return;
    }
    withdraw.mutate(amt, {
      onSuccess: (data) => {
        toast.success(`₹${data.amount} sent to your ${data.mode === "UPI" ? "UPI" : "bank account"}`);
        setAmount("");
      },
      onError: (e: any) => toast.error(e?.message ?? "Withdrawal failed"),
    });
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        <ArrowDownToLine className="h-3.5 w-3.5" /> Withdraw to bank / UPI
      </div>

      {/* Bank detail section */}
      {!hasBankDetail || editingBank ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Add your UPI ID or bank account to withdraw earnings.</p>
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
            <div className="space-y-1">
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
          <div className="flex gap-2">
            {editingBank && (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingBank(false)}>Cancel</Button>
            )}
            <Button className="flex-1 bg-foreground text-background hover:bg-foreground/90" onClick={handleSaveBank} disabled={saveBankDetail.isPending}>
              {saveBankDetail.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Check className="h-3.5 w-3.5" /> Save</>}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Saved bank detail */}
          <div className="rounded-md bg-muted/40 border px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <CreditCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate font-mono">
                  {bankDetail.upiId ?? `${bankDetail.accountNo?.slice(-4).padStart(bankDetail.accountNo.length, '•')}`}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {bankDetail.upiId ? "UPI" : `Bank · ${bankDetail.ifsc}`}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 text-xs h-7 px-2" onClick={() => setEditingBank(true)}>
              Change
            </Button>
          </div>

          {/* Withdraw amount */}
          {balance > payoutFee ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Amount to withdraw"
                    className="h-9 pl-8"
                    min={1}
                    max={maxWithdrawable}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-9 text-xs"
                  onClick={() => setAmount(maxWithdrawable.toFixed(2))}
                >
                  Max
                </Button>
              </div>
              {amount && parseFloat(amount) > 0 && (
                <div className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2 space-y-0.5">
                  <div className="flex justify-between"><span>You receive</span><span className="font-medium">₹{parseFloat(amount).toFixed(2)}</span></div>
                  <div className="flex justify-between text-warning"><span>Fee (₹5 + ₹0.90 GST)</span><span>₹{payoutFee.toFixed(2)}</span></div>
                  <div className="flex justify-between font-medium border-t pt-0.5 mt-0.5"><span>Wallet deducted</span><span>₹{(parseFloat(amount) + payoutFee).toFixed(2)}</span></div>
                </div>
              )}
              <Button
                className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
                onClick={handleWithdraw}
                disabled={withdraw.isPending || !amount || parseFloat(amount) < 1}
              >
                {withdraw.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…</>
                  : <><ArrowDownToLine className="h-3.5 w-3.5" /> Withdraw to {bankDetail.upiId ? "UPI" : "bank"}</>}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              Minimum balance to withdraw: ₹{(payoutFee + 1).toFixed(2)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Payout history ───────────────────────────────────────────────────────────

function PayoutHistory() {
  const { data } = useDriverPayouts();
  const payouts  = data?.payouts ?? [];

  if (payouts.length === 0) return null;

  const statusIcon = (s: PayoutTransaction["status"]) => {
    if (s === "processed")  return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    if (s === "failed")     return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    if (s === "reversed")   return <XCircle className="h-3.5 w-3.5 text-warning" />;
    return <Clock className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />;
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        Withdrawal history ({payouts.length})
      </div>
      <div className="space-y-2">
        {payouts.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-lg border text-xs">
            <div className="shrink-0">{statusIcon(p.status)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">₹{p.amount.toFixed(2)}</span>
                <span className="text-muted-foreground">→ {p.mode}</span>
                {p.utr && <span className="text-[10px] font-mono text-muted-foreground truncate">UTR: {p.utr}</span>}
              </div>
              <div className="text-muted-foreground mt-0.5">
                {format(new Date(p.createdAt), "dd MMM, HH:mm")}
                {" · "}fee ₹{p.fee.toFixed(2)}
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] shrink-0 capitalize ${
                p.status === "processed" ? "border-success/40 text-success"
                : p.status === "failed" || p.status === "reversed" ? "border-destructive/40 text-destructive"
                : "border-warning/40 text-warning"
              }`}
            >
              {p.status}
            </Badge>
          </div>
        ))}
      </div>
    </div>
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
