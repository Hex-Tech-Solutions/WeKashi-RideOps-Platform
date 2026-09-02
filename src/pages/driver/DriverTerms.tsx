/**
 * DriverTerms — rules & regulations the driver must accept on every login.
 *
 * Shown by DriverApp's Gate after a session exists but before DriverShell
 * mounts, so there is no route into the app that bypasses it. Acceptance is
 * held in sessionStorage rather than localStorage: sessionStorage is cleared
 * when the tab/app closes, so the driver re-accepts on each fresh login rather
 * than once, forever, on that device. Several rules (pre-duty vehicle checks,
 * uniform, punctuality) are per-shift obligations, so a one-time tick would
 * defeat the point.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, Check } from "lucide-react";

/** Cleared automatically when the session ends — re-accepted on next login. */
export const TERMS_ACCEPTED_KEY = "rideops_driver_terms_accepted";

const RULES: { title: string; detail: string }[] = [
  { title: "Valid documents", detail: "Carry a valid driving licence, vehicle documents, insurance, and all required permits." },
  { title: "Uniform & ID card", detail: "Wear the prescribed uniform and display your Wekashi Cabs ID card while on duty." },
  { title: "Punctuality", detail: "Report for duty and reach employee pickup points on time." },
  { title: "Safe driving", detail: "Follow all traffic rules and maintain a safe speed at all times. No rash or negligent driving." },
  { title: "No mobile phone while driving", detail: "Do not use a mobile phone while the vehicle is moving." },
  { title: "No alcohol or drugs", detail: "Driving under the influence of alcohol or drugs is strictly prohibited." },
  { title: "Employee safety", detail: "Pick up and drop employees only at authorised locations and ensure safe boarding and alighting." },
  { title: "Vehicle cleanliness", detail: "Keep the vehicle clean, hygienic, and in good working condition." },
  { title: "Professional behaviour", detail: "Treat employees respectfully. No arguments, harassment, inappropriate language, or misconduct." },
  { title: "No unauthorised passengers", detail: "Do not carry unauthorised passengers during employee transportation duty." },
  { title: "Route compliance", detail: "Follow the assigned route and instructions from the supervisor or transport coordinator." },
  { title: "Emergency reporting", detail: "Immediately report accidents, vehicle breakdowns, delays, or safety issues to the supervisor." },
  { title: "No smoking", detail: "Smoking inside the vehicle is strictly prohibited." },
  { title: "Vehicle inspection", detail: "Check brakes, tyres, lights, fuel, seat belts, and other safety equipment before starting duty." },
  { title: "Confidentiality", detail: "Do not share employee names, phone numbers, pickup or drop locations, or company information with unauthorised persons." },
  { title: "Attendance & trip records", detail: "Maintain accurate trip, pickup, drop, and attendance records as required." },
  { title: "Seat belt compliance", detail: "Wear your seat belt and encourage passengers to use seat belts where available." },
  { title: "Disciplinary action", detail: "Violations may result in a warning, suspension, removal from duty, or termination depending on the seriousness of the violation." },
];

export default function DriverTerms({
  driverName,
  onAccept,
}: {
  driverName?: string;
  onAccept: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="px-5 pt-6 pb-4 border-b">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-gradient-gold flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5 text-gold-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-bold tracking-tight">Driver Rules &amp; Regulations</div>
            <div className="text-xs text-muted-foreground">
              Wekashi Cabs · Employee Transportation
            </div>
          </div>
        </div>
        {driverName && (
          <p className="text-xs text-muted-foreground mt-3">
            Welcome back, <span className="font-medium text-foreground">{driverName}</span>. Please
            review and accept before starting duty.
          </p>
        )}
      </div>

      {/* Rules — scrollable */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <ol className="space-y-3">
          {RULES.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span className="h-5 w-5 rounded-full bg-secondary text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{r.detail}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-gold-dark font-semibold">
            Driver's priority
          </div>
          <div className="text-sm font-bold text-gold-dark mt-1">
            SAFE PICKUP · SAFE JOURNEY · SAFE DROP
          </div>
        </div>
      </div>

      {/* Accept — pinned */}
      <div className="border-t px-5 py-4 space-y-3 bg-background">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5 shrink-0"
          />
          <span className="text-xs leading-relaxed">
            I have read and understood the rules above, and I agree to follow them for the duration
            of my duty.
          </span>
        </label>

        <Button
          className="w-full bg-gold text-gold-foreground hover:bg-gold/90 disabled:opacity-50"
          disabled={!agreed}
          onClick={onAccept}
        >
          <Check className="h-4 w-4" /> Agree &amp; continue
        </Button>
      </div>
    </div>
  );
}
