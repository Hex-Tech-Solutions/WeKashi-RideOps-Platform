import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Shared login/logout label. Colour-coded across the whole app:
 *   • login  → green  (heading TO office)
 *   • logout → red    (heading FROM office)
 */
function isLogout(type: string): boolean {
  return type.toLowerCase() === "logout";
}

export function RideTypeBadge({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const logout = isLogout(type);
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        logout
          ? "border-red-600/40 text-red-700 bg-red-600/5"
          : "border-green-600/40 text-green-700 bg-green-600/5",
        className,
      )}
    >
      {type}
    </Badge>
  );
}

export function RideTypeText({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "capitalize font-medium",
        isLogout(type) ? "text-red-700" : "text-green-700",
        className,
      )}
    >
      {type}
    </span>
  );
}
