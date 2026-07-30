import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useCreateRouteTemplate } from "@/lib/queries";
import { Loader2, BookmarkPlus } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rideType: "login" | "logout";
  orderedEmployeeIds: string[];
  vehicleType?: string;
  officeLocationId?: string;
  /** Called after the template is saved successfully */
  onSaved?: () => void;
}

export function SaveRouteDialog({
  open, onOpenChange, rideType, orderedEmployeeIds, vehicleType, officeLocationId, onSaved,
}: Props) {
  const [name, setName] = useState("");
  const save = useCreateRouteTemplate();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Enter a name for this group"); return; }
    save.mutate(
      { name: trimmed, rideType, orderedEmployeeIds, vehicleType, officeLocationId },
      {
        onSuccess: () => {
          toast.success(`"${trimmed}" saved`);
          setName("");
          onOpenChange(false);
          onSaved?.();
        },
        onError: (e: any) => toast.error(e?.message ?? "Could not save"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setName(""); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="h-4 w-4 text-gold" />
            Save this group
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-1.5">
          <Label>Group name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Morning HSR batch, JP Nagar night shift…"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <p className="text-[11px] text-muted-foreground">
            Saves {orderedEmployeeIds.length} employee{orderedEmployeeIds.length === 1 ? "" : "s"} in the current order.
            You can load and reuse this group for future rides.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-foreground text-background hover:bg-foreground/90"
            onClick={submit}
            disabled={save.isPending}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
