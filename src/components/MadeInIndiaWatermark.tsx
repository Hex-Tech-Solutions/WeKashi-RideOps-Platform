/**
 * MadeInIndiaWatermark — "Proudly Made in India · Karnataka" with a softly
 * waving 3D Indian flag.
 *
 * Inline (NOT fixed) — embedded inside the dark sidebar footer of RoleLayout
 * (supervisor/vendor/admin) and the driver account panel's rail. When
 * `collapsed` is true it shows just the waving flag (centered), to fit the
 * narrow collapsed rail. Styled for a dark background.
 */
export function MadeInIndiaWatermark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={
        "select-none flex items-center gap-2 rounded-lg px-2 py-1.5 " +
        (collapsed ? "justify-center" : "")
      }
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
      title="Proudly Made in India · Karnataka"
    >
      {/* Keyframes scoped to this component. */}
      <style>{`
        @keyframes wm-wave {
          0%,100% { transform: skewY(0deg) translateY(0); }
          25%     { transform: skewY(-1.4deg) translateY(-0.4px); }
          50%     { transform: skewY(0deg) translateY(0.4px); }
          75%     { transform: skewY(1.4deg) translateY(-0.4px); }
        }
        .wm-flag-cloth { transform-origin: left center; animation: wm-wave 4.5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .wm-flag-cloth { animation: none; }
        }
      `}</style>

      <FlagWaving3D />

      {!collapsed && (
        <div className="leading-tight min-w-0">
          <div className="text-[10px] font-bold tracking-tight text-white/90 truncate">
            Proudly Made in India
          </div>
          <div
            className="text-[8px] font-extrabold uppercase tracking-[0.22em]"
            style={{
              background: "linear-gradient(90deg,#FF9933 0%,#ffffff 50%,#3fbf5f 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Karnataka
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A softly waving 3D Indian tricolour, inline SVG (no asset, crisp at any DPI).
 * The cloth path uses smooth curves so the trailing edge ripples; band
 * gradients + a diagonal sheen give it depth, and the whole cloth animates via
 * the `.wm-flag-cloth` skew keyframes above.
 */
function FlagWaving3D() {
  return (
    <svg
      width="30"
      height="24"
      viewBox="0 0 60 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="relative shrink-0"
      style={{ filter: "drop-shadow(0 3px 3px rgba(16,24,40,0.28))" }}
    >
      <defs>
        <linearGradient id="wm2-saffron" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFC38A" />
          <stop offset="45%" stopColor="#FF9933" />
          <stop offset="100%" stopColor="#E97C12" />
        </linearGradient>
        <linearGradient id="wm2-white" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#F5F5F5" />
          <stop offset="100%" stopColor="#E3E3E3" />
        </linearGradient>
        <linearGradient id="wm2-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2BB55C" />
          <stop offset="55%" stopColor="#138808" />
          <stop offset="100%" stopColor="#0C6606" />
        </linearGradient>
        <linearGradient id="wm2-sheen" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0)" />
          <stop offset="75%" stopColor="rgba(0,0,0,0.08)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.22)" />
        </linearGradient>
        <linearGradient id="wm2-pole" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b8b8c0" />
          <stop offset="45%" stopColor="#f2f2f7" />
          <stop offset="100%" stopColor="#8f8f99" />
        </linearGradient>
        {/* Clip so the chakra + sheen stay inside the waving cloth shape. */}
        <clipPath id="wm2-cloth">
          <path d="M8,4 C20,1 34,7 52,3 L52,33 C34,37 20,31 8,34 Z" />
        </clipPath>
      </defs>

      {/* Pole */}
      <rect x="4" y="3" width="3.4" height="42" rx="1.7" fill="url(#wm2-pole)" />
      <circle cx="5.7" cy="3" r="2.6" fill="#f2f2f7" stroke="#8f8f99" strokeWidth="0.5" />

      {/* Waving cloth group (animated) */}
      <g className="wm-flag-cloth">
        <g clipPath="url(#wm2-cloth)">
          {/* Three bands sized to the cloth bbox (y 1..37 → ~12 each) */}
          <rect x="8" y="0" width="44" height="13" fill="url(#wm2-saffron)" />
          <rect x="8" y="13" width="44" height="12" fill="url(#wm2-white)" />
          <rect x="8" y="25" width="44" height="13" fill="url(#wm2-green)" />

          {/* Ashoka Chakra */}
          <g transform="translate(30,18.5)" stroke="#0a3d91" strokeWidth="0.7" fill="none">
            <circle r="4.6" />
            <circle r="1" fill="#0a3d91" stroke="none" />
            {Array.from({ length: 24 }).map((_, i) => {
              const a = (i * Math.PI * 2) / 24;
              return (
                <line
                  key={i}
                  x1={Math.cos(a) * 1}
                  y1={Math.sin(a) * 1}
                  x2={Math.cos(a) * 4.6}
                  y2={Math.sin(a) * 4.6}
                />
              );
            })}
          </g>

          {/* Diagonal sheen for the 3D feel */}
          <rect x="8" y="0" width="44" height="38" fill="url(#wm2-sheen)" />
        </g>
        {/* Subtle outline on the cloth edge */}
        <path
          d="M8,4 C20,1 34,7 52,3 L52,33 C34,37 20,31 8,34 Z"
          fill="none"
          stroke="rgba(16,24,40,0.12)"
          strokeWidth="0.6"
        />
      </g>
    </svg>
  );
}
