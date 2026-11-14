import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { driverRequestOtp, driverRegister, ApiError } from "@/lib/api";
import { PhoneInput, toE164, isValidMobile } from "@/components/PhoneInput";
import { useDriverAuth } from "./useDriverAuth";
import { toast } from "sonner";
import { Loader2, Car, ArrowRight, CheckCircle2, Clock } from "lucide-react";

import { normalizeRegNo, isValidRegNo } from "@/lib/vehicleNo";

type Mode = "signin" | "signup";
type Step = "form" | "otp" | "requested";

/**
 * Driver sign-in / sign-up.
 *  - Sign in: phone -> OTP (only sent for an approved account).
 *  - New driver: name, phone, vehicle number, vendor code -> a sign-up REQUEST
 *    for the vendor to approve. No OTP is sent at sign-up; the driver signs in
 *    once the vendor approves.
 */
export default function DriverLogin() {
  const { login } = useDriverAuth();
  const [mode, setMode]   = useState<Mode>("signin");
  const [step, setStep]   = useState<Step>("form");
  const [busy, setBusy]   = useState(false);

  // The 10 mobile digits only; "+91" is fixed in the input.
  const [phone, setPhone] = useState("");
  const [otp, setOtp]     = useState("");

  // Sign-up only
  const [fullName, setFullName]     = useState("");
  const [vehicleNo, setVehicleNo]   = useState("");
  const [vendorCode, setVendorCode] = useState("");
  const [requestedVendor, setRequestedVendor] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep("form");
    setOtp("");
  };

  // ── Sign in: send OTP ───────────────────────────────────────────────────
  const handleSignIn = async () => {
    if (!isValidMobile(phone)) { toast.error("Enter a valid 10-digit mobile number"); return; }
    setBusy(true);
    try {
      await driverRequestOtp(toE164(phone));
      setStep("otp");
      toast.success("OTP sent");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not send OTP");
    } finally { setBusy(false); }
  };

  const handleVerify = async () => {
    setBusy(true);
    try {
      await login(toE164(phone), otp);
      toast.success("Welcome to Wekashi Cab");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Invalid OTP");
    } finally { setBusy(false); }
  };

  // ── Sign up: send the request to the vendor ─────────────────────────────
  const handleSignUp = async () => {
    if (fullName.trim().length < 2) { toast.error("Enter your full name"); return; }
    if (!isValidMobile(phone)) { toast.error("Enter a valid 10-digit mobile number"); return; }
    const reg = normalizeRegNo(vehicleNo);
    if (!isValidRegNo(reg)) { toast.error("Enter a valid vehicle number (e.g. KA05AB1234)"); return; }
    const code = vendorCode.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!/^VND-[A-Z0-9]{6}$/.test(code)) {
      toast.error("Enter a valid vendor code (format: VND-XXXXXX)");
      return;
    }
    setBusy(true);
    try {
      const res = await driverRegister({
        phone: toE164(phone), fullName: fullName.trim(), vehicleNo: reg, vendorCode: code,
      });
      setRequestedVendor(res.vendorName);
      setStep("requested");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not send your request");
    } finally { setBusy(false); }
  };

  const subtitle =
    step === "otp" ? "Enter the OTP sent to your phone"
    : step === "requested" ? "Request sent"
    : "Sign in or create a new account";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gold flex items-center justify-center mb-3">
            <Car className="h-7 w-7 text-gold-foreground" />
          </div>
          <div className="font-bold text-xl">Wekashi Cabs</div>
          <div className="text-sm text-muted-foreground">{subtitle}</div>
        </div>

        {/* Mode tabs — form step only */}
        {step === "form" && (
          <div className="flex rounded-lg border p-1 mb-4 bg-muted" role="tablist">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                  mode === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
                }`}
              >
                {m === "signin" ? "Sign in" : "New driver"}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-2xl border bg-card p-6 shadow-card space-y-4">

          {step === "requested" ? (
            /* ── Sign-up request sent ── */
            <>
              <div className="flex items-start gap-3 rounded-md bg-success/10 border border-success/30 px-3 py-3">
                <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-success">
                    Request sent to {requestedVendor}
                  </div>
                  <div className="text-xs text-success/80 mt-0.5">
                    Your vendor will review your details. Once they approve your account, sign in with
                    +91 {phone} — we'll send the OTP then.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Requests that aren't approved within 7 days expire and you can apply again.
              </div>
              <Button className="w-full" variant="outline" onClick={() => switchMode("signin")}>
                Go to sign in
              </Button>
            </>

          ) : step === "otp" ? (
            /* ── Sign-in OTP ── */
            <>
              <div>
                <Label htmlFor="otp">Enter OTP</Label>
                <Input
                  id="otp"
                  className="mt-1 tracking-[0.5em] text-center text-lg"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
                <div className="text-xs text-muted-foreground mt-1">Sent to +91 {phone}.</div>
              </div>
              <Button
                className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
                onClick={handleVerify}
                disabled={busy || otp.length !== 6}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Verify &amp; sign in <ArrowRight className="h-4 w-4" /></>}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => { setStep("form"); setOtp(""); }}>
                Back
              </Button>
            </>

          ) : mode === "signin" ? (
            /* ── Sign in form ── */
            <>
              <div>
                <Label htmlFor="signin-phone">Phone number</Label>
                <PhoneInput id="signin-phone" className="mt-1" value={phone} onChange={setPhone} onEnter={handleSignIn} />
              </div>
              <Button
                className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
                onClick={handleSignIn}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send OTP <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </>

          ) : (
            /* ── Sign up form ── */
            <>
              <div>
                <Label htmlFor="signup-name">Full name</Label>
                <Input
                  id="signup-name"
                  className="mt-1"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                />
              </div>
              <div>
                <Label htmlFor="signup-phone">Phone number</Label>
                <PhoneInput id="signup-phone" className="mt-1" value={phone} onChange={setPhone} />
              </div>
              <div>
                <Label htmlFor="signup-vehicle">Vehicle number</Label>
                <Input
                  id="signup-vehicle"
                  className="mt-1 font-mono tracking-widest uppercase"
                  value={normalizeRegNo(vehicleNo)}
                  onChange={(e) => setVehicleNo(e.target.value)}
                  placeholder="KA05AB1234"
                  maxLength={12}
                  autoCapitalize="characters"
                />
              </div>
              <div>
                <Label htmlFor="signup-vendor">Vendor Code</Label>
                <Input
                  id="signup-vendor"
                  className="mt-1 font-mono tracking-widest uppercase"
                  value={vendorCode.toUpperCase().replace(/[^A-Z0-9-]/g, "")}
                  onChange={(e) => setVendorCode(e.target.value)}
                  placeholder="VND-XXXXXX"
                  maxLength={10}
                  autoCapitalize="characters"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Ask your fleet manager for this code.
                </p>
              </div>
              <Button
                className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
                onClick={handleSignUp}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send for approval <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
