import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CubeField } from "@/components/CubeField";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { useSubmitRegistrationRequest } from "@/lib/queries";
import { toast } from "sonner";
import { ArrowRight, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";

const roleHome: Record<AppRole, string> = {
  admin: "/admin",
  vendor: "/vendor",
  supervisor: "/supervisor",
};

type Screen = "signin" | "register";

export default function Auth() {
  const nav = useNavigate();
  const { user, roles, loading, rolesLoading, signIn: doSignIn } = useAuth();
  const [screen, setScreen] = useState<Screen>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || rolesLoading) return;
    if (user && roles.length > 0) {
      const target = roles.includes("admin") ? "/admin"
                   : roles.includes("vendor") ? "/vendor"
                   : roleHome[roles[0]];
      nav(target, { replace: true });
    }
  }, [user, roles, loading, rolesLoading, nav]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await doSignIn(email, password);
      toast.success("Welcome back");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 text-white">
      <CubeField variant="dark" />

      <div className="relative w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="h-10 w-10 rounded-md bg-gradient-gold flex items-center justify-center font-bold text-gold-foreground">R</div>
          <div className="font-bold text-xl tracking-tight">RideOps</div>
        </Link>

        {screen === "signin" ? (
          <div className="rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl p-8 shadow-2xl">
            <div className="mb-6">
              <h1 className="text-lg font-semibold">Sign in</h1>
              <p className="text-sm text-white/50 mt-1">Admin, supervisor &amp; vendor access.</p>
            </div>

            <form onSubmit={signIn} className="space-y-4">
              <Field label="Work email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              <Field label="Password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
              <Button type="submit" disabled={busy} className="w-full bg-gold text-gold-foreground hover:bg-gold/90">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </form>

            <div className="mt-6 pt-5 border-t border-white/10 text-center">
              <p className="text-xs text-white/40 mb-2">Don't have an account?</p>
              <Button
                variant="outline"
                size="sm"
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                onClick={() => setScreen("register")}
              >
                Request an account
              </Button>
            </div>
          </div>
        ) : (
          <RegistrationForm onBack={() => setScreen("signin")} />
        )}

        <p className="text-center text-xs text-white/40 mt-6">
          Driver? Use the <Link to="/driver" className="text-gold hover:underline">driver app</Link>.
        </p>
      </div>
    </div>
  );
}

// ─── Registration Form ────────────────────────────────────────────────────────

function RegistrationForm({ onBack }: { onBack: () => void }) {
  const submit = useSubmitRegistrationRequest();
  const [role, setRole] = useState<"supervisor" | "vendor">("supervisor");
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    fullName: "", email: "", password: "", confirmPassword: "",
    mobile: "", companyName: "", gstin: "", address: "",
  });

  const f = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName || !form.email || !form.password || !form.mobile || !form.companyName || !form.address) {
      toast.error("All required fields must be filled"); return;
    }
    if (form.password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (form.password !== form.confirmPassword) { toast.error("Passwords do not match"); return; }
    const digits = form.mobile.replace(/[^\d]/g, "");
    if (digits.length < 10 || digits.length > 15) { toast.error("Enter a valid mobile number (10–15 digits)"); return; }

    submit.mutate(
      {
        role,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        mobile: digits,
        companyName: form.companyName.trim(),
        gstin: form.gstin.trim() || undefined,
        address: form.address.trim(),
      },
      {
        onSuccess: () => setSubmitted(true),
        onError: (e: any) => {
          // Show the specific field error if available
          const detail = e?.message ?? "Could not submit request";
          toast.error(detail);
        },
      },
    );
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl p-8 shadow-2xl text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 text-success mx-auto" />
        <h2 className="text-lg font-semibold">Request submitted!</h2>
        <p className="text-sm text-white/60">
          Your account request has been sent to the admin for review.
          You'll be able to sign in once it's approved.
        </p>
        <Button variant="outline" className="border-white/20 text-white/70 hover:text-white" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl p-8 shadow-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-white/50 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold">Request an account</h1>
          <p className="text-sm text-white/50 mt-0.5">Submit for admin review — you'll be notified on approval.</p>
        </div>
      </div>

      {/* Role tabs */}
      <div className="flex rounded-lg border border-white/10 p-1 mb-5 bg-white/5">
        {(["supervisor", "vendor"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              role === r ? "bg-gold text-gold-foreground" : "text-white/50 hover:text-white"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Full name *" value={form.fullName} onChange={f("fullName")} />
          </div>
          <div className="col-span-2">
            <Field label="Work email *" value={form.email} onChange={f("email")} type="email" />
          </div>
          <Field label="Password *" value={form.password} onChange={f("password")} type="password" />
          <Field label="Confirm password *" value={form.confirmPassword} onChange={f("confirmPassword")} type="password" />
          <Field label="Mobile number *" value={form.mobile} onChange={f("mobile")} type="tel" />
          <Field label={role === "vendor" ? "Company name *" : "Organisation *"} value={form.companyName} onChange={f("companyName")} />
          <div className="col-span-2">
            <Field label="GSTIN (optional)" value={form.gstin} onChange={f("gstin")} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-white/80">Registered address *</Label>
            <Textarea
              value={form.address}
              onChange={f("address")}
              rows={2}
              required
              className="bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-gold resize-none"
              placeholder="Full registered address"
            />
          </div>
        </div>

        <Button type="submit" disabled={submit.isPending} className="w-full bg-gold text-gold-foreground hover:bg-gold/90 mt-2">
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Submit request <ArrowRight className="h-4 w-4" /></>}
        </Button>
      </form>
    </div>
  );
}

// ─── Field helper ─────────────────────────────────────────────────────────────

function Field({ label, value, onChange, type = "text" }: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-white/80 text-xs">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={onChange}
        className="bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-gold h-9"
      />
    </div>
  );
}
