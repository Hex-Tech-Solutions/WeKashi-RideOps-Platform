import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface Props {
  initial?: { lat: number; lng: number; address?: string } | null;
  onChange: (v: { lat: number; lng: number; address: string }) => void;
}

// Google Maps picker: search an address, click the map, or drag the pin to set
// an exact office location. Emits {lat,lng,address} (reverse-geocoded).
export function OfficeMapPicker({ initial, onChange }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapRef.current) return;
        const center = initial?.lat ? { lat: initial.lat, lng: initial.lng } : { lat: 12.9716, lng: 77.5946 };
        const map = new google.maps.Map(mapRef.current, {
          center, zoom: initial?.lat ? 16 : 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        });
        const marker = new google.maps.Marker({ position: center, map, draggable: true });
        const geocoder = new google.maps.Geocoder();

        const setFrom = (latLng: google.maps.LatLng) => {
          marker.setPosition(latLng);
          map.panTo(latLng);
          geocoder.geocode({ location: latLng }, (results, status) => {
            const address = status === "OK" && results?.[0]
              ? results[0].formatted_address
              : `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`;
            onChange({ lat: latLng.lat(), lng: latLng.lng(), address });
          });
        };

        map.addListener("click", (e: google.maps.MapMouseEvent) => e.latLng && setFrom(e.latLng));
        marker.addListener("dragend", () => { const p = marker.getPosition(); if (p) setFrom(p); });

        if (searchRef.current && google.maps.places) {
          const ac = new google.maps.places.Autocomplete(searchRef.current, { fields: ["geometry", "formatted_address"] });
          ac.addListener("place_changed", () => {
            const place = ac.getPlace();
            if (place.geometry?.location) { map.setZoom(16); setFrom(place.geometry.location); }
          });
        }

        if (initial?.lat) onChange({ lat: initial.lat, lng: initial.lng, address: initial.address ?? "" });
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Failed to load Google Maps"); setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <Input ref={searchRef} placeholder="Search your office address…" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
      <div className="relative rounded-md overflow-hidden border" style={{ height: 320 }}>
        <div ref={mapRef} className="absolute inset-0" />
        {loading && !error && <div className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
        {error && <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive p-4 text-center bg-background/80">{error}<br />Add VITE_GOOGLE_MAPS_KEY to .env.prod and redeploy.</div>}
      </div>
      <div className="text-xs text-muted-foreground">Search, click the map, or drag the pin to set the exact office location.</div>
    </div>
  );
}
