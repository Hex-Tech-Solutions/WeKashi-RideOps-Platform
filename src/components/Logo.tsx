import { cn } from "@/lib/utils";

/**
 * Wekashi Cab brand logo (horizontal lockup).
 *
 * The source image already has a dark background baked in, so it sits cleanly
 * on the app's dark surfaces (login page, sidebar). Served from /public so it
 * loads without going through the bundler.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/wekashi-logo.jpg"
      alt="Wekashi Cab"
      className={cn("h-auto w-auto select-none", className)}
      draggable={false}
    />
  );
}
