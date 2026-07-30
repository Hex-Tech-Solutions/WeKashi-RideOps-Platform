import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { Input } from "@/components/ui/input";

interface Props {
  defaultValue?: string;
  placeholder?: string;
  onSelect: (v: { lat: number; lng: number; address: string }) => void;
}

// Google Places autocomplete text input → emits {lat,lng,address} on selection.
export function PlacesInput({ defaultValue, placeholder, onSelect }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !ref.current || !google.maps.places) return;
        const ac = new google.maps.places.Autocomplete(ref.current, { fields: ["geometry", "formatted_address"] });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (place.geometry?.location) {
            onSelect({
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng(),
              address: place.formatted_address ?? ref.current!.value,
            });
          }
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Input ref={ref} defaultValue={defaultValue} placeholder={placeholder ?? "Search address…"}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
  );
}
