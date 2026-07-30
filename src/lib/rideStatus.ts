// Ride status colour helper — used by badge components across the app.

export type RideStatus =
  | "broadcasting"
  | "assigned"
  | "in_progress"
  | "completed"
  | "pending"
  | "cancelled"
  | "scheduled"
  | "expired";

export function statusColor(s: string): string {
  switch (s) {
    case "broadcasting": return "bg-gold/15 text-gold-dark border-gold/40";
    case "pending":      return "bg-warning/15 text-warning border-warning/40";
    case "assigned":     return "bg-blue-100 text-blue-700 border-blue-300";
    case "in_progress":  return "bg-success/15 text-success border-success/40";
    case "completed":    return "bg-muted text-muted-foreground border-border";
    case "cancelled":    return "bg-destructive/15 text-destructive border-destructive/40";
    case "scheduled":    return "bg-secondary text-foreground border-border";
    case "expired":      return "bg-muted text-muted-foreground border-border";
    default:             return "bg-muted text-muted-foreground border-border";
  }
}
