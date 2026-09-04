/**
 * MadeInIndiaWatermark — a small, fixed, non-interactive badge shown on every
 * page: "Proudly Made in INDIA · KARNATAKA" with a 3D-styled Indian flag.
 *
 * Mounted once at the app root (inside BrowserRouter in App.tsx) so it appears
 * across all roles and public pages. `pointer-events-none` guarantees it never
 * intercepts clicks, and it sits in the bottom-right corner clear of most
 * primary actions.
 */

export function MadeInIndiaWatermark() {
  return (
    <div
      aria-hidden="true"
      className="fixed bottom-2 right-2 z-[60] pointer-events-none select-none"
    >
      <div
        className="flex items-center gap-2 rounded-full border border-white/40 bg-white/70 px-3 py-1.5 backdrop-blur-md"
        style={{
          boxShadow:
            "0 2px 4px rgba(0,0,0,0.12), 0 6px 16px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.9)",
        }}
      >
        <IndianFlag3D />
        <div className="leading-tight">
          <div
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{
              background: "linear-gradient(180deg,#111 0%,#333 60%,#555 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textShadow: "0 1px 0 rgba(255,255,255,0.6)",
            }}
          >
            Proudly Made in India
          </div>
          <div
            className="text-[8px] font-bold uppercase tracking-[0.18em]"
            style={{
              background: "linear-gradient(90deg,#FF9933 0%,#0a7d2c 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Karnataka
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A tiny 3D-looking Indian tricolour flag on a pole, drawn with inline SVG so
 * it needs no image asset and stays crisp at any DPI. The gradients + drop
 * shadow give it a subtle waving, raised feel.
 */
function IndianFlag3D() {
  return (
    <svg
      width="26"
      height="22"
      viewBox="0 0 52 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      style={{ filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.25))" }}
    >
      <defs>
        {/* Vertical light-to-shade sheen shared across the three bands to give
            the cloth a rounded, 3D bulge. */}
        <linearGradient id="wm-saffron" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFB866" />
          <stop offset="45%" stopColor="#FF9933" />
          <stop offset="100%" stopColor="#E6801A" />
        </linearGradient>
        <linearGradient id="wm-white" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#F3F3F3" />
          <stop offset="100%" stopColor="#DDDDDD" />
        </linearGradient>
        <linearGradient id="wm-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1F9E4A" />
          <stop offset="55%" stopColor="#0A7D2C" />
          <stop offset="100%" stopColor="#075E20" />
        </linearGradient>
        {/* A soft horizontal wave highlight overlaid on the whole flag. */}
        <linearGradient id="wm-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="35%" stopColor="rgba(255,255,255,0)" />
          <stop offset="70%" stopColor="rgba(0,0,0,0.10)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.25)" />
        </linearGradient>
        <linearGradient id="wm-pole" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#c9a24a" />
          <stop offset="50%" stopColor="#f4d98b" />
          <stop offset="100%" stopColor="#a67c22" />
        </linearGradient>
      </defs>

      {/* Pole */}
      <rect x="2" y="2" width="3.2" height="40" rx="1.6" fill="url(#wm-pole)" />
      <circle cx="3.6" cy="2.4" r="2.4" fill="#f4d98b" stroke="#a67c22" strokeWidth="0.5" />

      {/* Flag cloth — a gentle wave via a single rounded rect group skewed by
          the band paths. Three stacked bands + Ashoka Chakra. */}
      <g transform="translate(6.5,4)">
        <rect x="0" y="0" width="43" height="11" fill="url(#wm-saffron)" />
        <rect x="0" y="11" width="43" height="11" fill="url(#wm-white)" />
        <rect x="0" y="22" width="43" height="11" fill="url(#wm-green)" />

        {/* Ashoka Chakra */}
        <g transform="translate(21.5,16.5)" stroke="#0a3d91" strokeWidth="0.7" fill="none">
          <circle r="4.4" />
          <circle r="0.9" fill="#0a3d91" stroke="none" />
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i * Math.PI * 2) / 24;
            return (
              <line
                key={i}
                x1={Math.cos(a) * 0.9}
                y1={Math.sin(a) * 0.9}
                x2={Math.cos(a) * 4.4}
                y2={Math.sin(a) * 4.4}
              />
            );
          })}
        </g>

        {/* Sheen overlay for the 3D sheen/wave feel */}
        <rect x="0" y="0" width="43" height="33" fill="url(#wm-sheen)" />
      </g>
    </svg>
  );
}
