import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateDriverSos, type SosIssueType } from "@/lib/queries";
import { AlertTriangle, Car, HeartPulse, HelpCircle } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeRideId?: string;
  /** Called with the new issue id after SOS is successfully created */
  onCreated?: (issueId: string) => void;
}

const ISSUE_TYPES: {
  key: SosIssueType;
  label: string;
  Icon: typeof Car;
  desc: string;
  color: string;
}[] = [
  {
    key: "vehicle_issue",
    label: "Vehicle Issue",
    Icon: Car,
    desc: "Breakdown, tyre puncture, mechanical failure",
    color: "border-warning/50 bg-warning/10 text-warning-dark hover:border-warning",
  },
  {
    key: "medical_emergency",
    label: "Medical Emergency",
    Icon: HeartPulse,
    desc: "Passenger or driver needs medical attention",
    color: "border-destructive/50 bg-destructive/10 text-destructive hover:border-destructive",
  },
  {
    key: "other",
    label: "Other Issue",
    Icon: HelpCircle,
    desc: "Route diversion, passenger dispute, safety concern",
    color: "border-border bg-secondary hover:border-foreground/40",
  },
];

export function SosModal({ open, onOpenChange, activeRideId, onCreated }: Props) {
  const [step, setStep]             = useState<"type" | "detail">("type");
  const [selected, setSelected]     = useState<SosIssueType | null>(null);
  const [description, setDescription] = useState("");
  const createSos = useCreateDriverSos();

  const reset = () => {
    setStep("type");
    setSelected(null);
    setDescription("");
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const selectType = (key: SosIssueType) => {
    setSelected(key);
    setStep("detail");
  };

  const submit = () => {
    if (!selected) return;
    const desc = description.trim() || ISSUE_TYPES.find((t) => t.key === selected)!.desc;
    createSos.mutate(
      { issueType: selected, description: desc, rideId: activeRideId },
      {
        onSuccess: (issue) => {
          toast.success("SOS sent to your supervisor");
          onCreated?.(issue.id);
          handleClose(false);
        },
        onError: (e: any) => toast.error(e?.message ?? "Could not send SOS"),
      },
    );
  };

  const selectedType = ISSUE_TYPES.find((t) => t.key === selected);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {step === "type" ? "SOS — What's the issue?" : `SOS — ${selectedType?.label}`}
          </DialogTitle>
        </DialogHeader>

        {step === "type" ? (
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">
              Select the type of issue. Your supervisor will be notified immediately.
            </p>
            {ISSUE_TYPES.map(({ key, label, Icon, desc, color }) => (
              <button
                key={key}
                type="button"
                onClick={() => selectType(key)}
                className={`w-full flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${color}`}
              >
                <Icon className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-sm">{label}</div>
                  <div className="text-xs opacity-80 mt-0.5">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            {selectedType && (
              <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${selectedType.color}`}>
                <selectedType.Icon className="h-4 w-4 shrink-0" />
                <span className="font-medium">{selectedType.label}</span>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Add details <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Textarea
                className="mt-1.5"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Tyre punctured near highway overpass, need assistance…"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setStep("type")}
                disabled={createSos.isPending}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={submit}
                disabled={createSos.isPending}
              >
                {createSos.isPending ? "Sending…" : "Send SOS"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
