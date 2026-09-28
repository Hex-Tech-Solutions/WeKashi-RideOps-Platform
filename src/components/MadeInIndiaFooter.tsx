import madeInIndia from "@/assets/made-in-india.jpg";

/**
 * MadeInIndiaFooter — a warm, branded "Proudly made in India" banner shown on
 * the driver Rides tab to fill the empty space below the earnings card when the
 * driver is idle. Wraps the supplied Bengaluru skyline artwork in a soft
 * gradient card with a tricolour accent so it reads as an intentional footer,
 * not a stray image.
 */
export function MadeInIndiaFooter() {
  return (
    <div className="pt-6 pb-3 select-none">
      <div className="relative overflow-hidden rounded-2xl border border-gold/20 bg-gradient-to-b from-gold/5 to-transparent px-4 pt-4 pb-3">
        {/* Tricolour top accent */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#FF9933] via-white to-[#138808]" />

        <div className="text-center">
          <div className="text-[13px] font-semibold text-foreground/60 leading-tight">
            Proudly made
          </div>
          <div className="text-xl font-extrabold text-foreground/80 leading-tight inline-flex items-center gap-1">
            in India <span className="text-gold">♥</span>
          </div>
        </div>

        <img
          src={madeInIndia}
          alt="Bengaluru skyline"
          className="mt-2 w-full max-w-[260px] h-auto mx-auto opacity-90 mix-blend-multiply"
          loading="lazy"
          draggable={false}
        />

        <div className="text-center text-[11px] tracking-wide text-muted-foreground/70 -mt-1">
          RideOps · Bengaluru
        </div>
      </div>
    </div>
  );
}
