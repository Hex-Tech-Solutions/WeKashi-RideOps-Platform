import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Shared login/logout label. Ride type is always shown in green across the
 * app for quick visual scanning. Two variants:
 *   • <RideTypeBadge/>  — pill (outline) form, used wherever a Badge was shown
 *   • <RideTypeText/>   — inline text, used inside sentences / info rows
 */
export function RideTypeBadge({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize border-green-600/40 text-green-700 bg-green-600/5", className)}
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
  return <span className={cn("capitalize text-green-700 font-medium", className)}>{type}</span>;
}
