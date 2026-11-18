import { useState } from "react";
import { DriverAuthProvider, useDriverAuth } from "./useDriverAuth";
import DriverOnboarding from "./DriverOnboarding";
import DriverLogin from "./DriverLogin";
import DriverShell from "./DriverShell";
import { DriverPermissions } from "./DriverPermissions";
import { initCameraRestore } from "@/lib/nativeCamera";

// Pick up a photo taken while Android had the app closed (see nativeCamera.ts).
initCameraRestore();

const ONBOARDED_KEY = "rideops_driver_onboarded";
// Permissions checklist is shown until the driver has cleared it once per
// install (critical permissions granted). Persisted so it doesn't nag daily.
const PERMISSIONS_DONE_KEY = "wekashi_driver_permissions_done";

function Gate() {
  const { session } = useDriverAuth();
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDED_KEY) === "1");
  const [permsDone, setPermsDone] = useState(() => localStorage.getItem(PERMISSIONS_DONE_KEY) === "1");

  if (!onboarded) {
    return <DriverOnboarding onDone={() => { localStorage.setItem(ONBOARDED_KEY, "1"); setOnboarded(true); }} />;
  }
  if (!session) return <DriverLogin />;

  // The Rules & Regulations are NOT a gate here any more (Phase 2): the driver
  // accepts them every time they tap Online (DriverHome), and nowhere else.

  // Permissions checklist — the last gate before the app. Shown once per install
  // until the critical permissions (notifications, location, overlay, battery)
  // are granted, so ride alerts actually work in the field. No-op on web.
  if (!permsDone) {
    return (
      <DriverPermissions
        onAllCriticalGranted={() => {
          localStorage.setItem(PERMISSIONS_DONE_KEY, "1");
          setPermsDone(true);
        }}
      />
    );
  }

  return <DriverShell />;
}

export default function DriverApp() {
  return (
    <DriverAuthProvider>
      <Gate />
    </DriverAuthProvider>
  );
}
