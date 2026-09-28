/**
 * MadeInIndiaFooter — a light, full-width "Proudly made in India" banner with a
 * softly drawn city skyline. Used on the driver Rides tab to fill the empty
 * space below the earnings card when the driver is idle. Pure inline SVG, so
 * there's no image asset to ship and it stays crisp at any DPI.
 */
export function MadeInIndiaFooter() {
  return (
    <div
      aria-hidden="true"
      className="select-none pt-6 pb-2 text-center text-muted-foreground/70"
    >
      <div className="text-lg font-semibold leading-tight text-foreground/60">
        Proudly made
      </div>
      <div className="text-2xl font-extrabold leading-tight text-foreground/70 inline-flex items-center gap-1">
        in India
        <span className="text-gold text-xl">♥</span>
      </div>

      <div className="mt-3 px-6">
        <Skyline />
      </div>
    </div>
  );
}

function Skyline() {
  return (
    <svg
      viewBox="0 0 400 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto text-muted-foreground/30"
      preserveAspectRatio="xMidYEnd meet"
    >
      <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round">
        {/* ground line */}
        <line x1="0" y1="84" x2="400" y2="84" />

        {/* left temple / gopuram cluster */}
        <path d="M20,84 L20,58 L30,48 L40,58 L40,84 Z" />
        <path d="M46,84 L46,50 L56,40 L66,50 L66,84 Z" />
        <line x1="56" y1="40" x2="56" y2="32" />

        {/* tall tower with spire */}
        <path d="M84,84 L84,34 L96,22 L108,34 L108,84 Z" />
        <line x1="96" y1="22" x2="96" y2="12" />
        <rect x="90" y="44" width="4" height="6" />
        <rect x="98" y="44" width="4" height="6" />

        {/* central domed building (Vidhana Soudha style) */}
        <path d="M150,84 L150,44 L162,44 L162,84" />
        <path d="M150,44 C150,30 210,30 210,44" />
        <path d="M172,44 C172,20 188,20 188,44" />
        <ellipse cx="180" cy="20" rx="10" ry="6" />
        <line x1="180" y1="14" x2="180" y2="8" />
        <path d="M198,84 L198,44 L210,44 L210,84" />

        {/* small domes */}
        <path d="M224,84 L224,54 C224,44 240,44 240,54 L240,84 Z" />
        <path d="M246,84 L246,58 C246,50 258,50 258,58 L258,84 Z" />

        {/* modern high-rise */}
        <path d="M300,84 L300,26 L322,26 L322,84 Z" />
        <line x1="306" y1="34" x2="306" y2="80" />
        <line x1="312" y1="34" x2="312" y2="80" />
        <line x1="318" y1="34" x2="318" y2="80" />
        <line x1="300" y1="40" x2="322" y2="40" />
        <line x1="300" y1="54" x2="322" y2="54" />
        <line x1="300" y1="68" x2="322" y2="68" />

        {/* right dome building */}
        <path d="M344,84 L344,50 L356,40 L368,50 L368,84 Z" />
        <path d="M350,50 C350,42 362,42 362,50" />

        {/* trees */}
        <circle cx="130" cy="76" r="7" />
        <line x1="130" y1="83" x2="130" y2="76" />
        <circle cx="278" cy="76" r="7" />
        <line x1="278" y1="83" x2="278" y2="76" />
      </g>
    </svg>
  );
}
