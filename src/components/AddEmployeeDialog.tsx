/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlacesInput } from "@/components/PlacesInput";
import { TimeSelect } from "@/components/TimeSelect";
import { useCreateEmployee, useSupervisorOffice, useOfficeLocations, type CreateEmployeePayload } from "@/lib/queries";
import { getPoint, DROP } from "@/lib/geo";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { toast } from "sonner";
import { Building2, MapPin, Loader2, Move } from "lucide-react";

const mapStyle: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

export function AddEmployeeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const createEmployee = useCreateEmployee();
  const { data: officeData } = useSupervisorOffice();
  const { data: locationsData } = useOfficeLocations();

  const offices = locationsData?.offices ?? [];

  const [form, setForm] = useState({
    empId: "", name: "", gender: "M" as "M" | "F",
    phone: "", loginTime: "08:30", logoutTime: "18:30",
    companyLabel: "",
  });
  const [home, setHome] = useState<{ lat: number; lng: number; address: string } | null>(null);

  const isFemale = form.gender === "F";
  const effectivePhone = isFemale ? (officeData?.phone ?? "") : form.phone;

  const selectedOffice = offices.find((o) => o.name === form.companyLabel);
  const officeLoc = selectedOffice
    ? { lat: selectedOffice.lat, lng: selectedOffice.lng, address: selectedOffice.address }
    : officeData?.officeLat != null
    ? { lat: officeData.officeLat, lng: officeData.officeLng!, address: officeData.officeAddress ?? "Office" }
    : { lat: getPoint(DROP).lat, lng: getPoint(DROP).lng, address: DROP };

  const submit = () => {
    if (!form.name || !form.empId) { toast.error("Employee ID and name are required"); return; }
    if (!home) { toast.error("Search and select the employee's home address"); return; }
    if (isFemale && !officeData?.phone) {
      toast.error("Set your contact number in Settings first (POC for female employees)");
      return;
    }
    const digits = effectivePhone.replace(/[^\d]/g, "");
    const payload: CreateEmployeePayload = {
      empId: form.empId, name: form.name,
      gender: isFemale ? "female" : "male",
      phone: digits.length >= 10 && digits.length <= 15 ? digits : undefined,
      pickupLocation: { lat: home.lat, lng: home.lng },
      dropLocation: { lat: officeLoc.lat, lng: officeLoc.lng },
      pickupAddress: home.address, dropAddress: officeLoc.address,
      shiftStart: form.loginTime, shiftEnd: form.logoutTime,
      companyLabel: form.companyLabel || undefined,
    };
    createEmployee.mutate(payload, {
      onSuccess: () => {
        toast.success(`${form.name} added to roster`);
        onOpenChange(false);
        setForm({ empId: "", name: "", gender: "M", phone: "", loginTime: "08:30", logoutTime: "18:30", companyLabel: "" });
        setHome(null);
      },
      onError: (e: any) => toast.error(e?.message ?? "Could not add employee"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl overflow-hidden p-0">
        <div className="flex flex-col md:flex-row h-full min-h-0">

          {/* ── Left: form ───────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 p-6 overflow-y-auto max-h-[90vh]">
            <DialogHeader className="mb-4"><DialogTitle>Add employee</DialogTitle></DialogHeader>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Employee ID</Label><Input className="mt-1" value={form.empId} onChange={(e) => setForm({ ...form, empId: e.target.value })} placeholder="EMP-1234" /></div>
              <div><Label>Full name</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>

              <div>
                <Label>Gender</Label>
                <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v as "M" | "F" })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Male</SelectItem>
                    <SelectItem value="F">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Phone {isFemale && <span className="text-[10px] text-muted-foreground">(supervisor POC)</span>}</Label>
                {isFemale
                  ? <Input className="mt-1" value={officeData?.phone ?? "Set your number in Settings"} readOnly />
                  : <Input className="mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 ..." />
                }
              </div>

              {/* Company / Office */}
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Company / Office location
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">(optional)</span>
                </Label>
                {offices.length === 0 ? (
                  <div className="mt-1 text-xs text-muted-foreground rounded-md border px-3 py-2 bg-muted">
                    No offices saved yet — add them in Settings → Office Locations.
                  </div>
                ) : (
                  <Select value={form.companyLabel} onValueChange={(v) => setForm({ ...form, companyLabel: v })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select company / office…" /></SelectTrigger>
                    <SelectContent>
                      {offices.map((o) => (
                        <SelectItem key={o.id} value={o.name}>{o.name}{o.isDefault ? " (default)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedOffice && (
                  <div className="text-[11px] text-muted-foreground mt-1">Drop-off: {selectedOffice.address}</div>
                )}
              </div>

              {/* Home address */}
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> Home address
                </Label>
                <div className="mt-1">
                  <PlacesInput
                    placeholder="Search the employee's home address…"
                    onSelect={(v) => setHome(v)}
                  />
                </div>
                {home && (
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-start gap-1">
                    <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-gold" />
                    {home.address}
                  </div>
                )}
                {!home && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    After selecting, drag the pin on the map to fine-tune the exact location.
                  </div>
                )}
              </div>

              {!selectedOffice && (
                <div className="col-span-2 text-[11px] text-muted-foreground">
                  Drop: {officeLoc.address}{officeData?.officeLat == null ? " — set it in Settings" : ""}
                </div>
              )}

              <div>
                <Label>Login time</Label>
                <TimeSelect className="mt-1" value={form.loginTime} onChange={(v) => setForm({ ...form, loginTime: v })} />
              </div>
              <div>
                <Label>Logout time</Label>
                <TimeSelect className="mt-1" value={form.logoutTime} onChange={(v) => setForm({ ...form, logoutTime: v })} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={createEmployee.isPending}>
                {createEmployee.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</> : "Add employee"}
              </Button>
            </DialogFooter>
          </div>

          {/* ── Right: map ────────────────────────────────────────────────── */}
          <div className="w-full md:w-96 border-t md:border-t-0 md:border-l bg-muted/30 flex flex-col">
            <div className="px-4 py-3 border-b flex items-center gap-2 text-sm font-medium">
              <Move className="h-4 w-4 text-muted-foreground" />
              {home ? "Drag pin to exact location" : "Map preview"}
            </div>
            <div className="flex-1 relative min-h-[300px] md:min-h-0">
              <PinMap
                location={home}
                onMoved={(loc) => setHome(loc)}
              />
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Draggable pin map ─────────────────────────────────────────────────────────

function PinMap({
  location,
  onMoved,
}: {
  location: { lat: number; lng: number; address: string } | null;
  onMoved: (loc: { lat: number; lng: number; address: string }) => void;
}) {
  const mapEl  = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Boot map once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: { lat: 12.9716, lng: 77.5946 }, // Bangalore fallback
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          styles: mapStyle,
        });
        geocoderRef.current = new g.maps.Geocoder();
        setReady(true);
      })
      .catch((e) => setMapError(e.message));
    return () => { cancelled = true; };
  }, []);

  // Update marker when location changes from PlacesInput (new address selected)
  // Use a ref to track the last address we placed a marker for — only reposition
  // when the *address* changes (new PlacesInput selection), not when coordinates
  // change from dragging (which would cause an infinite loop).
  const lastPlacedAddress = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !mapRef.current || !location) return;
    // Only re-place the marker when a genuinely new address is selected
    if (lastPlacedAddress.current === location.address) return;
    lastPlacedAddress.current = location.address;

    const g = (window as any).google as typeof google;
    const pos = { lat: location.lat, lng: location.lng };

    mapRef.current.panTo(pos);
    mapRef.current.setZoom(17);

    // Remove old marker
    markerRef.current?.setMap(null);

    // Create new draggable marker
    const marker = new g.maps.Marker({
      map: mapRef.current,
      position: pos,
      draggable: true,
      cursor: "grab",
      animation: g.maps.Animation.DROP,
      title: "Drag to exact location",
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: "#D5B036",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 3,
      },
    });

    // On drag end — reverse geocode new position and update parent
    marker.addListener("dragend", async () => {
      const newPos = marker.getPosition();
      if (!newPos || !geocoderRef.current) return;
      const lat = newPos.lat();
      const lng = newPos.lng();
      try {
        const result = await geocoderRef.current.geocode({ location: { lat, lng } });
        const address = result.results[0]?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        // Update the address ref so we don't re-drop the marker on next render
        lastPlacedAddress.current = address;
        onMoved({ lat, lng, address });
      } catch {
        const address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        lastPlacedAddress.current = address;
        onMoved({ lat, lng, address });
      }
    });

    markerRef.current = marker;
  }, [ready, location?.address]); // only re-run when address string changes, not lat/lng

  return (
    <div className="absolute inset-0">
      <div ref={mapEl} className="absolute inset-0" />
      {!ready && !mapError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-muted-foreground gap-3">
          {location
            ? <><Loader2 className="h-5 w-5 animate-spin" /> Loading map…</>
            : (
              <>
                <MapPin className="h-10 w-10 text-muted-foreground/30" />
                <div className="text-center px-4">
                  <div className="font-medium text-foreground">No address selected</div>
                  <div className="text-xs mt-1">Search for a home address on the left to see it on the map</div>
                </div>
              </>
            )
          }
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive p-4 text-center">
          Map unavailable · Set VITE_GOOGLE_MAPS_KEY
        </div>
      )}
      {ready && location && (
        <div className="absolute bottom-3 left-3 right-3 bg-card/95 border shadow-sm rounded-md px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gold" />
          <span className="line-clamp-2">{location.address}</span>
        </div>
      )}
    </div>
  );
}
