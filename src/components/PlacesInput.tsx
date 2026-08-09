import { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  defaultValue?: string;
  placeholder?: string;
  onSelect: (v: { lat: number; lng: number; address: string }) => void;
}

interface Prediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

// Google Places autocomplete text input → emits {lat,lng,address} on selection.
//
// Renders its own suggestion list as regular React DOM (inside this component's
// own container) instead of using google.maps.places.Autocomplete's built-in
// dropdown. That built-in dropdown (`.pac-container`) is appended directly to
// `document.body`, completely outside any React tree — which puts it outside
// the DOM subtree of any Radix Dialog/Drawer/Popover this input is rendered
// inside. Radix's focus trap treats interactions with that dropdown as
// "outside" the dialog and intercepts them before the click can land, so
// suggestions were unclickable with a mouse (only arrow keys + Enter worked,
// since that interaction never leaves the input). Rendering our own dropdown
// avoids the conflict entirely, for this dialog and any future one.
export function PlacesInput({ defaultValue, placeholder, onSelect }: Props) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);

  const acServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !g.maps.places) return;
        acServiceRef.current = new g.maps.places.AutocompleteService();
        geocoderRef.current = new g.maps.Geocoder();
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Close the dropdown on outside clicks (this component's own container only —
  // nothing here depends on Radix, so it works the same inside or outside a dialog).
  useEffect(() => {
    function handleDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, []);

  const fetchPredictions = useCallback((input: string) => {
    if (!acServiceRef.current || !input.trim()) {
      setPredictions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    acServiceRef.current.getPlacePredictions({ input }, (results, status) => {
      setLoading(false);
      if (status !== "OK" || !results) {
        setPredictions([]);
        return;
      }
      setPredictions(
        results.map((r) => ({
          placeId: r.place_id,
          mainText: r.structured_formatting?.main_text ?? r.description,
          secondaryText: r.structured_formatting?.secondary_text ?? "",
        })),
      );
    });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    setActiveIndex(-1);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(v), 200);
  };

  const selectPrediction = (p: Prediction) => {
    setOpen(false);
    setPredictions([]);
    const fullText = p.secondaryText ? `${p.mainText}, ${p.secondaryText}` : p.mainText;
    setValue(fullText);
    if (!geocoderRef.current) return;
    geocoderRef.current.geocode({ placeId: p.placeId }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        onSelect({ lat: loc.lat(), lng: loc.lng(), address: results[0].formatted_address ?? fullText });
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (predictions.length === 0) return;
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, predictions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && predictions[activeIndex]) selectPrediction(predictions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        placeholder={placeholder ?? "Search address…"}
        onChange={handleChange}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && (predictions.length > 0 || loading) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md">
          {loading && predictions.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          ) : (
            predictions.map((p, i) => (
              <button
                key={p.placeId}
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                  i === activeIndex && "bg-accent",
                )}
                // Prevent the input from blurring before the click registers.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectPrediction(p)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium">{p.mainText}</span>
                  {p.secondaryText && <span className="text-muted-foreground"> {p.secondaryText}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
