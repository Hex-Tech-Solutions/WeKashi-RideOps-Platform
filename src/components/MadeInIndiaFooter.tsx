import madeInIndia from "@/assets/made-in-india.jpg";

/**
 * MadeInIndiaFooter — "Proudly made in India" banner used on the driver Rides
 * tab to fill the empty space below the earnings card when the driver is idle.
 * Uses the supplied artwork (src/assets/made-in-india.jpg), which Vite hashes
 * and bundles at build time.
 */
export function MadeInIndiaFooter() {
  return (
    <div className="select-none pt-6 pb-2 flex justify-center">
      <img
        src={madeInIndia}
        alt="Proudly made in India"
        className="w-full max-w-xs h-auto opacity-90"
        loading="lazy"
        draggable={false}
      />
    </div>
  );
}
