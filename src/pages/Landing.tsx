import { Link } from "react-router-dom";
import {
  ArrowRight,
  Sparkles,
  Clock,
  MapPin,
  ShieldCheck,
  Users,
  Truck,
  BarChart3,
  CheckCircle2,
  Zap,
  Lock,
  Phone,
  TrendingDown,
  Smile,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CubeField } from "@/components/CubeField";
import { useAuth } from "@/hooks/useAuth";

const features = [
  { icon: Sparkles, title: "Smart routing", desc: "Multi-pickup optimization with female-first / no-lone-female safety constraints baked in.", stat: "12+", statLabel: "route rules" },
  { icon: Clock, title: "3-min auction", desc: "Broadcast to drivers within 5 km. First-accept wins. Pending tab if nobody bites.", stat: "5 km", statLabel: "broadcast radius" },
  { icon: MapPin, title: "Live tracking", desc: "Real Google Maps routes, live driver location, in-app passenger details.", stat: "2 s", statLabel: "GPS refresh" },
  { icon: ShieldCheck, title: "Privacy-first", desc: "Vendors never see employees. Supervisors don't see driver PII until a ride is accepted.", stat: "ISO 27k", statLabel: "aligned controls" },
];

const steps = [
  {
    n: "01",
    title: "Supervisor books",
    desc: "Pick employees from the roster, set pickup time, choose vehicle class. Optimized route auto-generated on Google Maps.",
    image: "https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=1400&q=80&auto=format&fit=crop",
    tag: "Plan",
    metrics: [
      { v: "< 30s", l: "to book a ride" },
      { v: "1-tap", l: "route optimize" },
    ],
  },
  {
    n: "02",
    title: "3-minute auction",
    desc: "Request fans out to nearby vetted drivers within a 5 km radius. First to accept wins — smart fallback if no one bites.",
    image: "https://images.unsplash.com/photo-1581262177000-8139a463e531?w=1400&q=80&auto=format&fit=crop",
    tag: "Dispatch",
    metrics: [
      { v: "180s", l: "auction window" },
      { v: "5 km", l: "broadcast radius" },
    ],
  },
  {
    n: "03",
    title: "Driver picks up",
    desc: "Driver follows turn-by-turn directions, marks pickups one-by-one, completes the trip — supervisor sees every move live.",
    image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1400&q=80&auto=format&fit=crop",
    tag: "On the road",
    metrics: [
      { v: "94%", l: "on-time pickup" },
      { v: "Live", l: "GPS to console" },
    ],
  },
  {
    n: "04",
    title: "Auto reconciliation",
    desc: "Trip data flows straight into reports, vendor payouts and analytics dashboards — no spreadsheets, no month-end chaos.",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1400&q=80&auto=format&fit=crop",
    tag: "Settle",
    metrics: [
      { v: "T+0", l: "vendor invoicing" },
      { v: "0", l: "manual entries" },
    ],
  },
];

const benefits = [
  { icon: TrendingDown, stat: "Free", label: "For supervisors & drivers", desc: "No platform fee. Ever. You only pay for the cab rides." },
  { icon: Clock, stat: "< 3 min", label: "Average fill time", desc: "From booking to driver assignment." },
  { icon: Smile, stat: "94%", label: "On-time pickups", desc: "Versus 71% on legacy ETMS providers." },
  { icon: ShieldCheck, stat: "100%", label: "Safety compliance", desc: "Hard-coded female-safety guardrails." },
];

const fleet = [
  { name: "Maruti Swift", type: "Hatchback", seats: "4 seats", img: "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=900&q=85&auto=format&fit=crop" },
  { name: "Honda City", type: "Sedan", seats: "4 seats", img: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=900&q=85&auto=format&fit=crop" },
  { name: "Toyota Innova", type: "MPV", seats: "7 seats", img: "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=900&q=85&auto=format&fit=crop" },
  { name: "Toyota Fortuner", type: "SUV", seats: "7 seats", img: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=900&q=85&auto=format&fit=crop" },
];

const roles = [
  {
    icon: Users,
    role: "Supervisor",
    tagline: "Plan & track every ride",
    accent: "from-sky-500/20 via-sky-500/5 to-transparent",
    ring: "ring-sky-400/30",
    stat: "1-tap booking",
    points: ["Roster & route planning", "One-tap booking", "Live ride visibility", "Spend reports by cost-center"],
  },
  {
    icon: Truck,
    role: "Vendor",
    tagline: "Run your fleet, get paid faster",
    accent: "from-gold/30 via-gold/10 to-transparent",
    ring: "ring-gold/40",
    stat: "T+0 payouts",
    points: ["Driver onboarding & KYC", "Fleet & document tracking", "Live ride dispatch", "Real-time earnings"],
  },
  {
    icon: BarChart3,
    role: "Admin",
    tagline: "Full platform control",
    accent: "from-emerald-500/20 via-emerald-500/5 to-transparent",
    ring: "ring-emerald-400/30",
    stat: "360° visibility",
    points: ["Platform-wide live map", "Vendor & supervisor mgmt", "Payouts & analytics", "Safety controls & audit logs"],
  },
];

export default function Landing() {
  const { user, roles: userRoles } = useAuth();
  const dest = user
    ? userRoles.includes("admin") ? "/admin" : userRoles.includes("vendor") ? "/vendor" : "/supervisor"
    : "/auth";

  return (
    <div
      className="relative min-h-screen text-white overflow-hidden font-sans"
      style={{
        background:
          "radial-gradient(80% 60% at 20% 0%, hsl(46 65% 52% / 0.10), transparent 60%), radial-gradient(70% 50% at 90% 20%, hsl(46 80% 62% / 0.07), transparent 60%), linear-gradient(180deg, hsl(0 0% 4%) 0%, hsl(0 0% 7%) 40%, hsl(0 0% 4%) 100%)",
      }}
    >
      <CubeField variant="dark" />

      <header className="relative backdrop-blur-xl bg-black/40 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-gradient-gold flex items-center justify-center font-bold text-gold-foreground">R</div>
            <div className="font-bold text-lg tracking-tight">RideOps</div>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm text-white/60">
            <a href="#features" className="hover:text-white transition">Features</a>
            <a href="#how" className="hover:text-white transition">How it works</a>
            <a href="#benefits" className="hover:text-white transition">Benefits</a>
            <a href="#roles" className="hover:text-white transition">For teams</a>
          </nav>
          <Button asChild size="sm" className="bg-gold text-gold-foreground hover:bg-gold/90">
            <Link to={dest}>{user ? "Open console" : "Sign in"} <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </div>
      </header>

      {/* Hero — full-bleed cinematic background image, overlay shade, content on top */}
      <section className="relative overflow-hidden min-h-[88vh] flex items-center">
        {/* Background car image — covers the entire hero */}
        <div className="absolute inset-0 -z-10">
          <img
            src="https://images.weserv.nl/?url=images6.alphacoders.com/108/thumb-1920-1089828.jpg&w=2400&q=85"
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-center"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src =
                "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=2400&q=85&auto=format&fit=crop";
            }}
          />
          {/* Layered dark shade overlay so text reads crisply */}
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, hsl(0 0% 0% / 0.92) 0%, hsl(0 0% 0% / 0.55) 55%, hsl(0 0% 0% / 0.75) 100%)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(70% 60% at 20% 50%, hsl(46 65% 52% / 0.14), transparent 70%), linear-gradient(180deg, hsl(0 0% 0% / 0.45) 0%, transparent 35%, hsl(0 0% 0% / 0.85) 100%)",
            }}
          />
        </div>

        {/* Content on top */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 py-28 md:py-36">
          <div className="max-w-3xl text-left">
            <div className="inline-flex items-center gap-2 text-gold text-[11px] uppercase tracking-[0.3em] font-semibold mb-6">
              <span className="h-px w-8 bg-gold" /> A vetted driver marketplace
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
              Fill cab shortages<br />in <span className="text-shimmer">three minutes flat.</span>
            </h1>
            <p className="text-lg text-white/85 mt-6 max-w-xl leading-relaxed drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">
              When your primary employee transport runs out of cabs, RideOps connects supervisors directly to a vetted driver marketplace — with real-time routing, female-safety rules, and zero employee-app friction.
            </p>
            <div className="flex flex-wrap gap-3 mt-10">
              <Button asChild size="lg" className="bg-gold text-gold-foreground hover:bg-gold/90 shadow-gold">
                <Link to={dest}>Get started <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <a href="#how">See how it works</a>
              </Button>
            </div>
          </div>
        </div>
      </section>


      {/* ===== Premium Fleet — full-bleed cinematic, static, vignette ===== */}
      <section className="relative w-full overflow-hidden bg-black">
        {/* Wide hero image as TRUE background — covers the whole section, content sits on top */}
        <img
          src="https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=2400&q=85&auto=format&fit=crop"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
          loading="lazy"
        />
        {/* Heavy cinematic vignette so edges fully dissolve into black */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 30%, transparent 0%, transparent 25%, hsl(0 0% 0% / 0.65) 65%, hsl(0 0% 0% / 1) 100%)",
          }}
        />
        {/* Strong all-around dark wash for legibility */}
        <div className="absolute inset-0 bg-black/55 pointer-events-none" />
        {/* Top & bottom seamless blend into adjacent sections */}
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black to-transparent pointer-events-none" />
        {/* Side fades — hide hard image edges */}
        <div className="absolute inset-y-0 left-0 w-40 md:w-72 bg-gradient-to-r from-black to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-40 md:w-72 bg-gradient-to-l from-black to-transparent pointer-events-none" />
        {/* Gold rim light */}
        <div
          className="absolute inset-y-0 left-0 w-1/2 pointer-events-none"
          style={{ background: "linear-gradient(90deg, hsl(46 65% 52% / 0.10), transparent 70%)" }}
        />

        {/* Content — flows naturally, no fixed height, nothing clips */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 text-gold text-[11px] uppercase tracking-[0.25em] font-semibold mb-4">
              <span className="h-px w-8 bg-gold" /> A premium fleet, on tap
            </div>
            <h3 className="text-3xl md:text-6xl font-bold leading-[1.05] tracking-tight text-white">
              From hatchbacks to SUVs —<br />
              <span className="text-shimmer">vetted, tracked, on-time.</span>
            </h3>
            <p className="text-white/80 mt-5 text-base md:text-lg max-w-xl leading-relaxed">
              Every vehicle on RideOps is GPS-tracked, document-verified, and rated by supervisors after every trip — across four vehicle classes.
            </p>
          </div>

          {/* Fleet class strip */}
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-5">
            {fleet.map((f, idx) => (
              <div
                key={f.name}
                className="fleet-card group relative rounded-2xl overflow-hidden border border-white/10 bg-black/40 backdrop-blur-md"
                style={{ animationDelay: `${idx * 120}ms` }}
              >
                <div className="relative aspect-[4/5] overflow-hidden">
                  <img
                    src={f.img}
                    alt={f.name}
                    className="w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-110"
                    loading="lazy"
                  />
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background:
                        "radial-gradient(110% 90% at 50% 40%, transparent 35%, hsl(0 0% 0% / 0.55) 75%, hsl(0 0% 0% / 0.95) 100%)",
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/30" />
                  <div className="fleet-sweep pointer-events-none" />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-gold/90 text-gold-foreground text-[10px] uppercase tracking-widest font-bold transition-transform duration-500 group-hover:-translate-y-0.5">
                    {f.type}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-4 transition-transform duration-500 group-hover:-translate-y-1">
                    <div className="font-bold text-base md:text-lg text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">{f.name}</div>
                    <div className="text-[11px] text-white/85 mt-0.5">{f.seats}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features — diagonal stripes */}
      <section id="features" className="relative py-24">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, transparent, hsl(0 0% 4%) 15%, hsl(0 0% 4%) 85%, transparent), repeating-linear-gradient(135deg, hsl(0 0% 100% / 0.025) 0 2px, transparent 2px 18px)",
          }}
        />
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="text-gold text-xs uppercase tracking-widest font-semibold mb-3">Features</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Built for ops teams who can't afford a no-show.</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 [perspective:1200px]">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="card-tilt card-glow card-shine relative p-6 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] group"
                >
                  {/* Corner stat chip */}
                  <div className="absolute top-4 right-4 text-right">
                    <div className="text-lg font-bold text-gold leading-none">{f.stat}</div>
                    <div className="text-[10px] text-white/40 mt-1 uppercase tracking-wider">{f.statLabel}</div>
                  </div>
                  <div className="h-11 w-11 rounded-xl bg-gold/15 text-gold flex items-center justify-center mb-5 group-hover:bg-gold group-hover:text-gold-foreground group-hover:rotate-6 transition-all duration-500">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold text-lg mb-2">{f.title}</h3>
                  <p className="text-sm text-white/60 leading-relaxed">{f.desc}</p>
                  <div className="mt-5 h-px bg-gradient-to-r from-gold/40 to-transparent" />
                  <div className="mt-3 text-[11px] uppercase tracking-widest text-white/40 flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-gold" /> 0{i + 1} · production-ready
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works — radial spotlight */}
      <section id="how" className="relative py-28">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(50% 60% at 50% 50%, hsl(46 65% 52% / 0.08), transparent 70%), linear-gradient(180deg, hsl(0 0% 6%), hsl(0 0% 3%))",
          }}
        />
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <div className="text-gold text-xs uppercase tracking-widest font-semibold mb-3">How it works</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">From booking to bill in four steps.</h2>
            <p className="text-white/60 mt-4">A workflow shaped by hundreds of supervisor and vendor conversations.</p>
          </div>
          {/* Cinematic large image cards — no icons, with metric chips */}
          <div className="grid md:grid-cols-2 gap-7 [perspective:1600px]">
            {steps.map((s, i) => (
              <article
                key={s.n}
                className="step-card group border border-white/10 min-h-[520px] md:min-h-[560px] flex flex-col"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                {/* Image occupies top portion only */}
                <div className="relative h-[55%] overflow-hidden">
                  <div className="step-bg !inset-0" style={{ backgroundImage: `url(${s.image})` }} />
                  <div className="step-sweep" />
                  {/* Fade the image into the dark content band below */}
                  <div className="absolute inset-x-0 bottom-0 h-1/2 z-[1] pointer-events-none bg-gradient-to-b from-transparent to-black" />

                  {/* Giant step numeral on the image */}
                  <div className="absolute top-2 right-5 z-[2] text-[8rem] md:text-[11rem] leading-none font-black text-white/15 group-hover:text-gold/45 transition-colors duration-700 select-none">
                    {s.n}
                  </div>
                  {/* Tag chip */}
                  <div className="absolute top-6 left-6 z-[2] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-white/15 backdrop-blur text-[10px] uppercase tracking-widest text-gold font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-gold pulse-gold" /> {s.tag}
                  </div>
                </div>

                {/* Solid dark content band — title + desc + chips sit cleanly here */}
                <div className="step-content relative flex-1 bg-black p-7 md:p-9 flex flex-col justify-end">
                  <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-3 transition-transform duration-500 group-hover:translate-x-1">
                    {s.title}
                  </h3>
                  <p className="text-sm md:text-base text-white/75 leading-relaxed max-w-md mb-5">
                    {s.desc}
                  </p>
                  <div className="flex flex-wrap gap-2.5">
                    {s.metrics.map((m) => (
                      <div
                        key={m.l}
                        className="flex items-baseline gap-2 px-3 py-1.5 rounded-lg bg-white/10 border border-white/15 backdrop-blur"
                      >
                        <span className="text-base font-bold text-gold leading-none">{m.v}</span>
                        <span className="text-[10px] uppercase tracking-wider text-white/60">{m.l}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits — dot grid background */}
      <section id="benefits" className="relative py-28">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, hsl(0 0% 4%), hsl(0 0% 6%)), radial-gradient(hsl(0 0% 100% / 0.05) 1px, transparent 1px)",
            backgroundSize: "auto, 22px 22px",
            backgroundBlendMode: "normal, lighten",
          }}
        />
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <div>
              <div className="text-gold text-xs uppercase tracking-widest font-semibold mb-3">Why RideOps</div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">
                Stop paying for empty cabs.<br /><span className="text-shimmer">Pay only for the rides you take.</span>
              </h2>
              <p className="text-white/70 mt-5 leading-relaxed">
                RideOps is free for supervisors and drivers. You only pay for the cab rides — transparent per-ride pricing, real-time auctions, and zero idle cost.
              </p>
              <ul className="mt-8 space-y-3">
                {[
                  "Free for supervisors — no setup fee, no monthly charge",
                  "Free for drivers — download, onboard, start earning",
                  "Live cost tracking per ride, per cost-center",
                  "Compliance reports generated automatically",
                  "Driver KYC and document expiry alerts handled by vendors",
                ].map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm text-white/80">
                    <CheckCircle2 className="h-5 w-5 text-gold shrink-0 mt-0.5" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-4 [perspective:1200px]">
              {benefits.map((b, i) => {
                const Icon = b.icon;
                return (
                  <div
                    key={b.label}
                    className={`card-tilt card-glow card-shine p-6 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md ${i % 2 ? "translate-y-6" : ""}`}
                  >
                    <Icon className="h-6 w-6 text-gold mb-3" />
                    <div className="text-3xl font-bold">{b.stat}</div>
                    <div className="text-sm font-medium text-white/80 mt-1">{b.label}</div>
                    <div className="text-xs text-white/50 mt-2 leading-relaxed">{b.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Roles — gold wash */}
      <section id="roles" className="relative py-28">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, hsl(0 0% 5%), hsl(0 0% 7%)), conic-gradient(from 220deg at 50% 50%, hsl(46 65% 52% / 0.10), transparent 30%, hsl(46 65% 52% / 0.06) 70%, transparent)",
            backgroundBlendMode: "normal, screen",
          }}
        />
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="text-gold text-xs uppercase tracking-widest font-semibold mb-3">Made for every role</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">One platform. Three purpose-built consoles.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6 [perspective:1200px]">
            {roles.map((r, i) => (
              <div
                key={r.role}
                className={`card-tilt card-glow card-shine relative p-7 rounded-2xl border border-white/10 bg-gradient-to-br ${r.accent} backdrop-blur-md ring-1 ${r.ring} overflow-hidden`}
              >
                {/* Big watermark numeral */}
                <div className="absolute -bottom-6 -right-2 text-[7rem] font-black text-white/[0.04] leading-none select-none pointer-events-none">
                  0{i + 1}
                </div>

                <div className="flex items-center justify-between mb-5">
                  <div className="px-2.5 py-1 rounded-full bg-gold/15 border border-gold/30 text-[10px] uppercase tracking-widest text-gold font-bold">
                    {r.stat}
                  </div>
                </div>

                <h3 className="text-2xl font-bold">{r.role}</h3>
                <p className="text-sm text-white/55 mt-1 mb-6">{r.tagline}</p>

                <ul className="space-y-2.5 relative">
                  {r.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm text-white/75">
                      <CheckCircle2 className="h-4 w-4 text-gold shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security strip — image cards with overlay */}
      <section className="relative py-24">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-black/60 to-transparent" />
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="text-gold text-xs uppercase tracking-widest font-semibold mb-3">Trust & support</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Built like infrastructure, supported like a partner.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { title: "Enterprise security", desc: "Role-based access, encrypted at rest, full audit trails on every action.", img: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=1200&q=85&auto=format&fit=crop" },
              { title: "Safety guardrails", desc: "Female-first pickup rules and no-lone-female enforcement, hard-coded.", img: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=1200&q=85&auto=format&fit=crop" },
              { title: "24×7 ops support", desc: "Live escalation channel for supervisors and admins, real humans on call.", img: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1200&q=85&auto=format&fit=crop" },
            ].map((s) => (
              <article
                key={s.title}
                className="group relative h-72 rounded-2xl overflow-hidden border border-white/10 hover:border-gold/50 transition-all duration-500 hover:-translate-y-1 hover:shadow-gold"
              >
                <img src={s.img} alt={s.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/65 to-black/15" />
                <div className="absolute inset-x-0 bottom-0 p-6">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-gold font-semibold mb-2">Pillar</div>
                  <h3 className="font-bold text-xl text-white drop-shadow">{s.title}</h3>
                  <p className="text-sm text-white/80 mt-2 leading-relaxed">{s.desc}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-28">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(50% 80% at 50% 50%, hsl(46 65% 52% / 0.18), transparent 70%), hsl(0 0% 3%)",
          }}
        />
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            Ready to make cab shortages a <span className="text-shimmer">non-event?</span>
          </h2>
          <p className="text-white/70 mt-5 max-w-xl mx-auto">
            Sign in to the role-based console and run your first on-demand ride in under five minutes.
          </p>
          <div className="flex flex-wrap gap-3 mt-9 justify-center">
            <Button asChild size="lg" className="bg-gold text-gold-foreground hover:bg-gold/90 shadow-gold">
              <Link to={dest}>{user ? "Open my console" : "Sign in to continue"} <ArrowRight className="h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10 hover:text-white">
              <a href="#features">Explore features</a>
            </Button>
          </div>
        </div>
      </section>

      <footer className="relative py-8 bg-black/90">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-white/40">
          <div>© 2026 RideOps · Employee transport, on-demand</div>
          <div className="flex gap-5">
            <a href="#features" className="hover:text-white transition">Features</a>
            <a href="#how" className="hover:text-white transition">How it works</a>
            <a href="#benefits" className="hover:text-white transition">Benefits</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
