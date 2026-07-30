import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Car, Radio, Wallet, ShieldCheck, Check, ArrowRight, ArrowLeft } from "lucide-react";

const SLIDES = [
  { icon: Car, title: "Welcome to RideOps Driver", body: "Get matched with nearby corporate rides and earn on your schedule.", tint: "bg-gold/15 text-gold" },
  { icon: Radio, title: "Go online, get broadcasts", body: "Flip online and receive ride requests near you in real time. First to accept wins the trip.", tint: "bg-blue-500/15 text-blue-500" },
  { icon: Wallet, title: "Drive & earn", body: "Start the trip, complete it, and watch your earnings add up — tracked automatically.", tint: "bg-success/15 text-success" },
];

const RULES = [
  "Keep your KYC & vehicle documents valid and up to date.",
  "Verify the pickup before starting — confirm passengers on board.",
  "Female-safety first: never leave a lone female passenger first or last.",
  "Don't cancel after accepting unless it's an emergency.",
  "Drive safe, follow traffic rules, no rash driving.",
];

export default function DriverOnboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const total = SLIDES.length + 1; // + rules slide
  const isRules = step === SLIDES.length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        {!isRules ? (
          <div key={step} className="animate-in fade-in slide-in-from-right-6 duration-300 flex flex-col items-center">
            <div className={`h-24 w-24 rounded-3xl flex items-center justify-center mb-8 ${SLIDES[step].tint}`}>
              {(() => { const Icon = SLIDES[step].icon; return <Icon className="h-11 w-11" />; })()}
            </div>
            <h1 className="text-2xl font-bold mb-3">{SLIDES[step].title}</h1>
            <p className="text-muted-foreground max-w-xs">{SLIDES[step].body}</p>
          </div>
        ) : (
          <div key="rules" className="animate-in fade-in slide-in-from-right-6 duration-300 w-full max-w-sm">
            <div className="h-20 w-20 rounded-3xl bg-gold/15 text-gold flex items-center justify-center mb-6 mx-auto"><ShieldCheck className="h-9 w-9" /></div>
            <h1 className="text-2xl font-bold mb-5">Rules & safety</h1>
            <div className="space-y-3 text-left">
              {RULES.map((r) => (
                <div key={r} className="flex items-start gap-3 text-sm">
                  <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dots */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`h-2 rounded-full transition-all ${i === step ? "w-6 bg-gold" : "w-2 bg-muted"}`} />
        ))}
      </div>

      {/* Controls */}
      <div className="px-6 pb-10 flex items-center gap-3">
        {step > 0 && (
          <Button variant="outline" size="icon" onClick={() => setStep((s) => s - 1)}><ArrowLeft className="h-4 w-4" /></Button>
        )}
        {!isRules ? (
          <Button className="flex-1 bg-gold text-gold-foreground hover:bg-gold/90" onClick={() => setStep((s) => s + 1)}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="flex-1 bg-gold text-gold-foreground hover:bg-gold/90" onClick={onDone}>
            I understand & agree <Check className="h-4 w-4" />
          </Button>
        )}
        {!isRules && (
          <Button variant="ghost" onClick={onDone}>Skip</Button>
        )}
      </div>
    </div>
  );
}
