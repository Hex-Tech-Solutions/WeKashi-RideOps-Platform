import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIdentityFlags, useResolveIdentityFlag, type IdentityFlagRow } from "@/lib/queries";
import { Loader2, Check } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const KIND_LABELS: Record<string, string> = {
  shared_device: "Same device",
};

/**
 * Possible duplicate accounts — soft signals only (nothing is blocked). An
 * admin reviews each pair and marks it reviewed.
 */
export default function DuplicateFlags() {
  const { data, isLoading } = useIdentityFlags();
  const resolve = useResolveIdentityFlag();
  const flags = data?.flags ?? [];

  return (
    <div>
      <PageHeader
        title="Possible duplicates"
        description="Accounts that may belong to the same person. These are signals only — nobody is blocked."
      />
      {isLoading ? (
        <Card className="shadow-card"><CardContent className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></CardContent></Card>
      ) : flags.length === 0 ? (
        <Card className="shadow-card"><CardContent className="py-16 text-center text-sm text-muted-foreground">No open flags.</CardContent></Card>
      ) : (
        <Card className="shadow-card overflow-hidden">
          <ul className="divide-y">
            {flags.map((f) => (
              <li key={f.id} className="px-5 py-3 grid grid-cols-1 md:grid-cols-[1fr_2fr_2fr_auto] gap-2 md:gap-4 md:items-center text-sm">
                <div>
                  <Badge variant="outline" className="border-warning/40 text-warning">{KIND_LABELS[f.kind] ?? f.kind}</Badge>
                  <div className="text-xs text-muted-foreground mt-1">{format(new Date(f.createdAt), "dd MMM yyyy, h:mm a")}</div>
                </div>
                <DriverCell d={f.driver} />
                <DriverCell d={f.otherDriver} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate(f.id, {
                    onSuccess: () => toast.success("Marked as reviewed"),
                    onError: (e: any) => toast.error(e?.message ?? "Failed"),
                  })}
                >
                  <Check className="h-4 w-4" /> Reviewed
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function DriverCell({ d }: { d: IdentityFlagRow["driver"] }) {
  if (!d) return <div className="text-muted-foreground">Unknown driver</div>;
  return (
    <div className="min-w-0">
      <div className="font-medium truncate">{d.fullName}</div>
      <div className="text-xs text-muted-foreground truncate">
        {d.phone} · {d.vendor?.name ?? "—"} · <span className="capitalize">{d.status}</span>
      </div>
    </div>
  );
}
