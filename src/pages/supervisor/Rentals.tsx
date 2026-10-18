import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PlacesInput } from "@/components/PlacesInput";
import {
  useRentalPacks, useRentals, useCreateRental, useCancelRental, useRemoveRental,
  type RentalPack, type RentalRow,
} from "@/lib/queries";
import { ArrowRight, Route, Clock, IndianRupee, Car, Users, Phone, Trash2, Loader2, CalendarClock, X } from "lucide-react";
import { toast } from "sonner";

export default function Rentals() {
  const [vehicleType, setVehicleType] = useState<"sedan" | "suv">("sedan");
  const { data: packsData } = useRentalPacks(vehicleType);
  const { data: rentalsData } = useRentals();
  const createRental = useCreateRental();
  const cancelRental = useCancelRental();
  const removeRental = useRemoveRental();

  const packs = packsData?.packs ?? [];
  const rentals = rentalsData?.rentals ?? [];

  const [bookPack, setBookPack] = useState<RentalPack | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  return (
    <div className="w-full">
      <PageHeader
        title="Rentals"
        description="Book a Sedan or SUV rental for a customer. Any eligible opted-in driver in the fleet can accept it."
      />

      {/* Vehicle type selector */}
      <Tabs value={vehicleType} onValueChange={(v) => setVehicleType(v as "sedan" | "suv")} className="mb-5">
        <TabsList>
          <TabsTrigger value="sedan"><Car className="h-3.5 w-3.5 mr-1.5" /> Sedan</TabsTrigger>
          <TabsTrigger value="suv"><Car className="h-3.5 w-3.5 mr-1.5" /> SUV</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Package cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {packs.map((p) => (
          <PackageCard key={p.key} pack={p} onBook={() => setBookPack(p)} />
        ))}
      </div>

      {/* Booked rentals */}
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
        Your rentals ({rentals.length})
      </div>
      {rentals.length === 0 ? (
        <Card className="shadow-card"><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No rentals yet. Pick a package above to book one.
        </CardContent></Card>
      ) : (
        // Cap the visible area to ~8 rows and scroll the rest, so a long
        // history (especially cancelled rows) doesn't run the page down.
        <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
          {rentals.map((r) => (
            <RentalRowCard
              key={r.id}
              rental={r}
              onCancel={() => setCancelId(r.id)}
              onRemove={() => removeRental.mutate(r.id, {
                onSuccess: () => toast.success("Rental removed"),
                onError: (e: any) => toast.error(e?.message ?? "Failed to remove"),
              })}
            />
          ))}
        </div>
      )}

      {/* Book dialog */}
      <BookRentalDialog
        pack={bookPack}
        open={!!bookPack}
        onOpenChange={(o) => !o && setBookPack(null)}
        onSubmit={(payload) => {
          createRental.mutate(payload, {
            onSuccess: () => { toast.success("Rental booked — broadcasting to drivers"); setBookPack(null); },
            onError: (e: any) => toast.error(e?.message ?? "Failed to book rental"),
          });
        }}
        submitting={createRental.isPending}
      />

      {/* Cancel confirm */}
      <AlertDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this rental?</AlertDialogTitle>
            <AlertDialogDescription>
              The rental will be cancelled and removed from drivers' feeds. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelId) cancelRental.mutate(cancelId, {
                  onSuccess: () => toast.success("Rental cancelled"),
                  onError: (e: any) => toast.error(e?.message ?? "Failed"),
                });
                setCancelId(null);
              }}
            >
              Cancel rental
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Package card (gold palette, styled after the reference) ────────────────────
function PackageCard({ pack, onBook }: { pack: RentalPack; onBook: () => void }) {
  return (
    <Card className={`relative shadow-card transition-colors ${pack.popular ? "border-gold ring-1 ring-gold/40" : "hover:border-gold/40"}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="text-xl font-extrabold text-gold-dark">
            {pack.hours} HR {pack.km} KM
          </div>
          {pack.popular && (
            <Badge className="bg-gold text-gold-foreground text-[10px] font-bold">POPULAR</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Route className="h-3 w-3" /> Extra per km</div>
            <div className="font-semibold text-sm">₹{pack.extraPerKm}/km</div>
          </div>
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> Extra per hr</div>
            <div className="font-semibold text-sm">₹{pack.extraPerHr}/hr</div>
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground">Starts at ₹{pack.basePrice}</div>
            <div className="text-2xl font-extrabold">₹{pack.basePrice.toLocaleString("en-IN")}</div>
          </div>
          <button
            onClick={onBook}
            className="h-11 w-11 rounded-full bg-gold text-gold-foreground flex items-center justify-center hover:bg-gold/90 shadow-gold"
            title="Book this package"
          >
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Booked rental row ──────────────────────────────────────────────────────────
function RentalRowCard({ rental: r, onCancel, onRemove }: { rental: RentalRow; onCancel: () => void; onRemove: () => void }) {
  const statusColor =
    r.status === "broadcasting" ? "border-gold/50 text-gold-dark bg-gold/10"
    : r.status === "completed" ? "border-success/40 text-success bg-success/5"
    : r.status === "cancelled" ? "border-destructive/40 text-destructive bg-destructive/5"
    : "border-foreground/30 text-foreground";

  const removable = r.status === "cancelled" || r.status === "completed";
  const pickup = r.scheduledFor
    ? new Date(r.scheduledFor).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    : "Now";

  return (
    <Card className="shadow-card">
      <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-[160px]">
          <div className="font-semibold text-sm flex items-center gap-2">
            {r.customerName}
            <Badge variant="outline" className="capitalize text-[10px]">{r.vehicleType}</Badge>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {r.customerPhone}</div>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {r.hours}h · {r.km}km</span>
          <span className="flex items-center gap-1 font-semibold text-foreground"><IndianRupee className="h-3 w-3" />{r.basePrice}</span>
          <span className="flex items-center gap-1" title="Pickup time"><CalendarClock className="h-3.5 w-3.5" /> {pickup}</span>
          <span className="truncate max-w-[200px]" title={r.pickupAddress}>{r.pickupAddress}</span>
        </div>
        <Badge variant="outline" className={`capitalize ${statusColor}`}>{r.status.replace("_", " ")}</Badge>
        {r.driver && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {r.driver.fullName}
          </span>
        )}
        <div className="ml-auto">
          {removable ? (
            // Cancelled/completed rentals can be permanently removed to keep the
            // list tidy.
            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onRemove} title="Remove from list">
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onCancel} title="Cancel rental">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Book dialog ──────────────────────────────────────────────────────────────
function BookRentalDialog({
  pack, open, onOpenChange, onSubmit, submitting,
}: {
  pack: RentalPack | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (p: {
    customerName: string; customerPhone: string; vehicleType: "sedan" | "suv";
    packageKey: string; pickupAddress: string; pickupPoint?: { lat: number; lng: number }; scheduledFor?: string; notes?: string;
  }) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickup, setPickup] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [pickupTime, setPickupTime] = useState("");
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!pack) return;
    if (!name.trim()) { toast.error("Enter the customer name"); return; }
    if (phone.replace(/\D/g, "").length < 10) { toast.error("Enter a valid mobile number"); return; }
    if (!pickup) { toast.error("Select the pickup location"); return; }
    // Pickup time is optional (a rental can start "now"); when set it must be
    // in the future so a driver isn't handed an already-past pickup.
    let scheduledFor: string | undefined;
    if (pickupTime) {
      const t = new Date(pickupTime);
      if (isNaN(t.getTime())) { toast.error("Enter a valid pickup time"); return; }
      if (t.getTime() < Date.now() - 60_000) { toast.error("Pickup time can't be in the past"); return; }
      scheduledFor = t.toISOString();
    }
    onSubmit({
      customerName: name.trim(),
      customerPhone: phone.trim(),
      vehicleType: pack.vehicleType,
      packageKey: pack.key,
      pickupAddress: pickup.address,
      pickupPoint: { lat: pickup.lat, lng: pickup.lng },
      scheduledFor,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Book rental — {pack && `${pack.hours}h / ${pack.km}km ${pack.vehicleType.toUpperCase()} · ₹${pack.basePrice}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Customer name</Label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Mobile number</Label><Input className="mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" /></div>
          </div>
          <div>
            <Label>Pickup location</Label>
            <div className="mt-1"><PlacesInput placeholder="Search pickup address…" onSelect={(v) => setPickup(v)} /></div>
            {pickup && <div className="text-[11px] text-muted-foreground mt-1">{pickup.address}</div>}
          </div>
          <div>
            <Label>Pickup time (optional)</Label>
            <Input
              type="datetime-local"
              className="mt-1"
              value={pickupTime}
              onChange={(e) => setPickupTime(e.target.value)}
            />
            <div className="text-[11px] text-muted-foreground mt-1">Leave blank to dispatch now.</div>
          </div>
          <div><Label>Notes (optional)</Label><Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any instructions for the driver" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button className="bg-gold text-gold-foreground hover:bg-gold/90" onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Booking…</> : "Broadcast rental"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
