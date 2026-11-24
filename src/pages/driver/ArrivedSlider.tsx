/**
 * ArrivedSlider - the driver drags the thumb all the way right to confirm they
 * are at a pickup. Used for the ride's first pickup (DriverHome) and for every
 * later login stop (DriverTrip). The server checks GPS (within 150 m), so a
 * failed attempt resets the slider and the caller shows the reason.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronsRight } from "lucide-react";

export default function ArrivedSlider({
  onArrived,
  isPending,
  label = "Slide to confirm arrival at pickup location",
  note = "This stamps your reporting time for on-time delivery tracking.",
}: {
  onArrived: () => void;
  isPending: boolean;
  label?: string;
  note?: string | null;
}) {
  const [value, setValue] = useState(0);
  const confirmed = value >= 95;
  const wasPending = useRef(false);

  // The request finished while we are still on screen: it failed (on success the
  // parent removes the slider), so let the driver try again.
  useEffect(() => {
    if (wasPending.current && !isPending) setValue(0);
    wasPending.current = isPending;
  }, [isPending]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setValue(v);
    if (v >= 95) onArrived();
  };
  // Reset if not yet confirmed and user releases thumb mid-way
  const handleRelease = () => {
    if (!confirmed) setValue(0);
  };

  return (
    <div className={`rounded-lg border px-4 py-3 space-y-2 transition-colors ${confirmed ? "border-success/50 bg-success/5" : "border-gold/40 bg-gold/5"}`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-gold-dark">
        <ChevronsRight className="h-3.5 w-3.5 animate-pulse" />
        {label}
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          disabled={isPending || confirmed}
          onChange={handleChange}
          onMouseUp={handleRelease}
          onTouchEnd={handleRelease}
          className="w-full h-10 appearance-none rounded-full cursor-pointer disabled:cursor-default"
          style={{
            background: `linear-gradient(to right, hsl(var(--gold)) ${value}%, hsl(var(--muted)) ${value}%)`,
            WebkitAppearance: "none",
          }}
        />
        {!confirmed && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none select-none">
            {value < 10 ? "Slide right →" : value < 95 ? "Keep going →" : ""}
          </span>
        )}
        {confirmed && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-success font-semibold pointer-events-none select-none">
            ✓ Arrived
          </span>
        )}
      </div>
      {note && <div className="text-[10px] text-muted-foreground">{note}</div>}
    </div>
  );
}
