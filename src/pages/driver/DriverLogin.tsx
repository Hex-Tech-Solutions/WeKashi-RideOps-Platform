import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { driverRequestOtp, driverRegister, ApiError } from "@/lib/api";
import { useDriverAuth } from "./useDriverAuth";
import { toast } from "sonner";
import { Loader2, Car, ArrowRight, CheckCircle2 } from "lucide-react";

type Mode = "signin" | "signup";
type Step = "form" | "otp";

export default function DriverLogin() {
  const { login } = useDriverAuth();
  const [mode, setMode]   = useState<Mode>("signin");
  const [step, setStep]   = useState<Step>("form");
  const [busy, setBusy]   = useState(false);

  // Shared
  const [phone, setPhone] = useState("+91");
  const [otp, setOtp]     = useState("");

  // Sign-up only
  const [fullName, setFullName]       = useState("");
  const [vendorCode, setVendorCode]   = useState("");
  const [confirmedVendor, setConfirmedVendor] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep("form");
    setOtp("");
    setConfirmedVendor(null);
  };

  // ── Sign in: send OTP ─────────────────────────────────────────────────────
  const handleSignIn = async () => {
    const digits = phone.replace(/[^\d]/g, "");
    if (digits.length < 10) { toast.error("Enter a valid phone number"); return; }
    setBusy(true);
    try {
      await driverRequestOtp("+" + digits);
      setStep("otp");
      toast.success("OTP sent");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not send OTP");
    } finally { setBusy(false); }
  };

  // ── Sign up: register + send OTP ─────────────────────────────────────────
  const handleSignUp = async () => {
    const digits = phone.replace(/[^\d]/g, "");
    if (digits.length < 10) { toast.error("Enter a valid phone number"); return; }
    if (fullName.trim().length < 2) { toast.error("Enter your full name"); return; }
    const code = vendorCode.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!/^VND-[A-Z0-9]{6}$/.test(code)) {
      toast.error("Enter a valid vendor code (format: VND-XXXXXX)");
      return;
    }
    setBusy(true);
    try {
      const res = await driverRegister({ phone: "+" + digits, fullName: fullName.trim(), vendorCode: code });
      setConfirmedVendor(res.vendorName);
      setStep("otp");
      toast.success(`Account created under ${res.vendorName}. OTP sent.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Registration failed");
    } finally { setBusy(false); }
  };

  // ── Verify OTP (same for both flows) ────────────────────────────────────
  const handleVerify = async () => {
    setBusy(true);
    try {
      await login("+" + phone.replace(/[^\d]/g, ""), otp);
      toast.success("Welcome to RideOps");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Invalid OTP");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gold flex items-center justify-center mb-3">
            <Car className="h-7 w-7 text-gold-foreground" />
          </div>
          <div className="font-bold text-xl">RideOps Driver</div>
          <div className="text-sm text-muted-foreground">
            {step === "otp" ? "Enter the OTP sent to your phone" : "Sign in or create a new account"}
          </div>
        </div>

        {/* Mode tabs — only shown on the form step */}
        {step === "form" && (
          <div className="flex rounded-lg border p-1 mb-4 bg-muted">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === "signin" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === "signup" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              New driver
            </button>
          </div>
        )}

        <div className="rounded-2xl border bg-card p-6 shadow-card space-y-4">

          {/* ── OTP step (shared) ── */}
          {step === "otp" ? (
            <>
              {confirmedVendor && (
                <div className="flex items-center gap-2 rounded-md bg-success/10 border border-success/30 px-3 py-2.5">
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-success">Registered under {confirmedVendor}</div>
                    <div className="text-xs text-success/80">Complete sign-in with the OTP below</div>
                  </div>
                </div>
              )}
              <div>
                <Label>Enter OTP</Label>
                <Input
                  className="mt-1 tracking-[0.5em] text-center text-lg"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  inputMode="numeric"
                />
                <div className="text-xs text-muted-foreground mt-1">Sent to {phone}.</div>
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
                <Label>Phone number</Label>
                <Input
                  className="mt-1"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 90000 00001"
                  inputMode="tel"
                />
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
                <Label>Full name</Label>
                <Input
                  className="mt-1"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ramesh Kumar"
                />
              </div>
              <div>
                <Label>Phone number</Label>
                <Input
                  className="mt-1"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 90000 00001"
                  inputMode="tel"
                />
              </div>
              <div>
                <Label>Vendor Code</Label>
                <Input
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
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create account &amp; send OTP <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Seeded drivers: +919000000001 / 2 / 3 · OTP: 123456
        </p>
      </div>
    </div>
  );
}
