// Fixed airport terminal anchors (Bengaluru — BLR). These are approximate
// terminal centroids; the exact pickup/drop spot is coordinated on the ground
// between supervisor, driver, and passenger. Used as the fixed end of an
// airport ride (drop for to-airport, pickup for from-airport).
import type { VehicleType } from './pricing';

export type AirportTerminal = 'T1' | 'T2';
export type AirportDirection = 'to_airport' | 'from_airport';

export const AIRPORT_TERMINALS: Record<AirportTerminal, { name: string; lat: number; lng: number }> = {
  T1: { name: 'Terminal 1', lat: 13.198756668464007, lng: 77.70662145355523 },
  T2: { name: 'Terminal 2', lat: 13.199965793832208, lng: 77.71464340117798 },
};

export function terminalPoint(t: AirportTerminal): { lat: number; lng: number } {
  const term = AIRPORT_TERMINALS[t];
  return { lat: term.lat, lng: term.lng };
}

export function terminalLabel(t: AirportTerminal): string {
  return AIRPORT_TERMINALS[t]?.name ?? t;
}

// Allowed airport vehicle types — same set as normal rides.
export const AIRPORT_VEHICLE_TYPES: VehicleType[] = ['hatchback', 'sedan', 'suv'];
