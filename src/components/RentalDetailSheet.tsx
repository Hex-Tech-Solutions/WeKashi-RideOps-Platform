/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRentalDetail, type RentalDetail } from "@/lib/queries";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { CarFront, Download, Loader2, MapPin, Clock, Gauge, IndianRupee, Phone } from "lucide-react";
import { format } from "date-fns";

interface Props {
  rentalId?: string;
  onClose: () => void;
}

// Human-readable duration from seconds — shows seconds for sub-minute trips so
// a short rental is never misleadingly displayed as "0m".
function fmtDuration(sec: number): string {
  if (sec <= 0) return "0s";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

export function RentalDetailSheet({ rentalId, onClose }: Props) {
  const { data: rental, isLoading, isError } = useRentalDetail(rentalId);

  return (
    <Sheet open={!!rentalId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="text-sm flex items-center gap-2">
            <CarFront className="h-4 w-4 text-gold" />
            Rental detail
            {rental && <span className="font-mono text-xs text-muted-foreground ml-1">{rental.id.slice(0, 8)}</span>}
            {rental && (
              <button
                type="button"
                onClick={() => downloadRentalReceipt(rental)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gold/50 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold-dark hover:bg-gold/20"
                title="Download rental receipt"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </button>
            )}
          </SheetTitle>
        </SheetHeader>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {isError && (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive px-6 text-center">
            Could not load rental details.
          </div>
        )}

        {rental && (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              <RentalTrailMap rental={rental} />

              <div className="flex items-center gap-2 flex-wrap text-sm">
                <Badge variant="outline" className="capitalize">{rental.vehicleType}</Badge>
                <Badge variant="outline" className="capitalize">{rental.status.replace("_", " ")}</Badge>
                {rental.noShow && <Badge variant="outline" className="border-destructive/40 text-destructive">no-show</Badge>}
                <span className="text-muted-foreground">{rental.hours}h / {rental.km}km pack</span>
              </div>

              {/* Customer */}
              <div className="rounded-md border p-3 text-sm space-y-1">
                <div className="font-medium">{rental.customerName}</div>
                {rental.customerPhone && <div className="text-muted-foreground flex items-center gap-1 text-xs"><Phone className="h-3 w-3" /> {rental.customerPhone}</div>}
                <div className="text-muted-foreground flex items-start gap-1 text-xs"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /> {rental.pickupAddress}</div>
              </div>

              {/* Trip metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Duration</div>
                  <div className="text-lg font-bold">{fmtDuration(rental.elapsedSec)}</div>
                  <div className="text-[11px] text-muted-foreground">of {rental.hours}h pack</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Gauge className="h-3 w-3" /> Distance</div>
                  <div className="text-lg font-bold">{rental.distanceKm} km</div>
                  <div className="text-[11px] text-muted-foreground">of {rental.km} km pack</div>
                </div>
              </div>

              {/* Fare */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground"><span>Base package</span><span>₹{rental.basePrice}</span></div>
                {rental.overageAmount > 0 && (
                  <div className="flex justify-between text-muted-foreground"><span>Overage ({rental.overageKm}km / {rental.overageHours}h)</span><span>+₹{rental.overageAmount}</span></div>
                )}
                <div className="flex justify-between font-semibold border-t pt-1.5"><span>Total</span><span className="flex items-center gap-0.5"><IndianRupee className="h-3.5 w-3.5" />{rental.totalAmount ?? rental.basePrice}</span></div>
              </div>

              {/* Timeline */}
              <div className="rounded-md border p-3 text-xs space-y-1">
                {rental.createdAt && <Row label="Booked" value={fmt(rental.createdAt)} />}
                {rental.acceptedAt && <Row label="Accepted" value={fmt(rental.acceptedAt)} />}
                {rental.startedAt && <Row label="Started" value={fmt(rental.startedAt)} />}
                {rental.completedAt && <Row label="Completed" value={fmt(rental.completedAt)} />}
              </div>

              {/* Payment */}
              {rental.paymentStatus === "paid" && (
                <div className="rounded-md border border-success/30 bg-success/5 p-3 text-xs flex items-center justify-between">
                  <span className="text-success font-medium">Paid{rental.paymentReceivedAt ? " · driver confirmed" : ""}</span>
                  {rental.paymentRef && <span className="font-mono text-muted-foreground">UTR ••••{rental.paymentRef}</span>}
                </div>
              )}

              {rental.locationTrail.length < 2 && (
                <div className="text-[11px] text-muted-foreground text-center">
                  No GPS trail recorded (the trip was too short or the device didn't move enough to log points).
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function fmt(iso: string): string {
  try { return format(new Date(iso), "d MMM, HH:mm:ss"); } catch { return iso; }
}

// ─── Trail map ────────────────────────────────────────────────────────────────

function RentalTrailMap({ rental }: { rental: RentalDetail }) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        const center = rental.pickupLat != null && rental.pickupLng != null
          ? { lat: rental.pickupLat, lng: rental.pickupLng }
          : { lat: 12.95, lng: 77.6 };
        mapRef.current = new g.maps.Map(mapEl.current, {
          center, zoom: 13, disableDefaultUI: true, zoomControl: true,
          styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }, { featureType: "transit", stylers: [{ visibility: "off" }] }],
        });
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const g = google;
    const bounds = new g.maps.LatLngBounds();
    let any = false;

    if (rental.pickupLat != null && rental.pickupLng != null) {
      new g.maps.Marker({
        map: mapRef.current,
        position: { lat: rental.pickupLat, lng: rental.pickupLng },
        label: { text: "P", color: "#fff", fontWeight: "700" },
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 11, fillColor: "#111", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
      });
      bounds.extend({ lat: rental.pickupLat, lng: rental.pickupLng });
      any = true;
    }

    if (rental.locationTrail.length >= 2) {
      const path = rental.locationTrail.map((p) => ({ lat: p.lat, lng: p.lng }));
      path.forEach((p) => bounds.extend(p));
      new g.maps.Polyline({
        map: mapRef.current,
        path,
        strokeColor: "#2563eb",
        strokeWeight: 4,
        strokeOpacity: 0.9,
      });
      // End marker
      const end = path[path.length - 1];
      new g.maps.Marker({
        map: mapRef.current,
        position: end,
        label: { text: "D", color: "#fff", fontWeight: "700" },
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 11, fillColor: "#2563eb", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
      });
      any = true;
    }

    if (any) mapRef.current.fitBounds(bounds, 48);
  }, [ready, rental]);

  return (
    <div className="relative rounded-lg border overflow-hidden bg-muted" style={{ aspectRatio: "16 / 10" }}>
      <div ref={mapEl} className="absolute inset-0" />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
        </div>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive p-4 text-center">{error}</div>}
    </div>
  );
}

// ─── Receipt download ─────────────────────────────────────────────────────────

// HTML-escape every interpolated value. The receipt is written into a
// same-origin about:blank popup (window.open('') + document.write), so an
// unescaped attacker-controlled field (driver name, customer name, address,
// reg no) would execute script in the app origin and could read the auth
// tokens from localStorage. Escaping closes that XSS sink.
function esc(s: string | null | undefined): string {
  return (s ?? "—").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function downloadRentalReceipt(r: RentalDetail): void {
  const id = r.id.slice(0, 8);
  const generated = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });
  // Values are escaped here so the row template below can interpolate safely.
  const rows: Array<[string, string]> = [
    ["Rental ID", esc(id)],
    ["Status", esc(r.status)],
    ["Customer", esc(r.customerName)],
    ["Mobile", esc(r.customerPhone)],
    ["Vehicle", esc(r.vehicleType)],
    ["Package", `${r.hours}h / ${r.km}km`],
    ["Pickup", esc(r.pickupAddress)],
    ["Started", r.startedAt ? esc(fmt(r.startedAt)) : "—"],
    ["Completed", r.completedAt ? esc(fmt(r.completedAt)) : "—"],
    ["Duration", esc(fmtDuration(r.elapsedSec))],
    ["Distance", `${r.distanceKm} km`],
    ["Base", `₹${r.basePrice}`],
    ["Overage", `₹${r.overageAmount}`],
    ["Total", `₹${r.totalAmount ?? r.basePrice}`],
    ["Driver", esc(r.driver?.fullName)],
    ["Vehicle no.", esc(r.driver?.vehicle?.regNo)],
    ["Payment", r.paymentStatus === "paid" ? `Paid${r.paymentRef ? ` (UTR ••••${esc(r.paymentRef)})` : ""}` : "Unpaid"],
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Rental Receipt ${esc(id)}</title>
    <style>body{font-family:system-ui,Arial,sans-serif;max-width:560px;margin:24px auto;color:#111}
    h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:13px}
    td{padding:6px 4px;border-bottom:1px solid #eee}td:first-child{color:#666;width:40%}
    .foot{margin-top:16px;font-size:11px;color:#888}</style></head>
    <body><h1>Wekashi Cabs — Rental Receipt</h1>
    <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v ?? "—"}</td></tr>`).join("")}</table>
    <div class="foot">Generated ${esc(generated)} · For bill-claim reference only.</div></body></html>`;
  const win = window.open("", "_blank");
  if (!win) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RentalReceipt_${id}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  win.document.write(html);
  win.document.close();
}
