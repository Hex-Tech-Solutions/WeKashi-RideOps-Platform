import { useState } from "react";
import { DriverAuthProvider, useDriverAuth } from "./useDriverAuth";
import DriverOnboarding from "./DriverOnboarding";
import DriverLogin from "./DriverLogin";
import DriverShell from "./DriverShell";
import DriverTerms, { TERMS_ACCEPTED_KEY } from "./DriverTerms";
import { DriverPermissions } from "./DriverPermissions";

const ONBOARDED_KEY = "rideops_driver_onboarded";
// Permissions checklist is shown until the driver has cleared it once per
// install (critical permissions granted). Persisted so it doesn't nag daily.
const PERMISSIONS_DONE_KEY = "wekashi_driver_permissions_done";

function Gate() {
  const { session } = useDriverAuth();
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDED_KEY) === "1");
  // sessionStorage, not localStorage — acceptance lasts for this session only,
  // so the driver re-accepts the rules on every fresh login.
  const [termsAccepted, setTermsAccepted] = useState(
    () => sessionStorage.getItem(TERMS_ACCEPTED_KEY) === "1",
  );

  const [permsDone, setPermsDone] = useState(() => localStorage.getItem(PERMISSIONS_DONE_KEY) === "1");

  if (!onboarded) {
    return <DriverOnboarding onDone={() => { localStorage.setItem(ONBOARDED_KEY, "1"); setOnboarded(true); }} />;
  }
  if (!session) return <DriverLogin />;

  // Rules gate — sits between login and the app, so there is no way in without
  // accepting. Placed here rather than inside DriverShell so no tab, deep link,
  // or restored session can skip it.
  if (!termsAccepted) {
    return (
      <DriverTerms
        driverName={session.fullName}
        onAccept={() => {
          sessionStorage.setItem(TERMS_ACCEPTED_KEY, "1");
          setTermsAccepted(true);
        }}
      />
    );
  }

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
