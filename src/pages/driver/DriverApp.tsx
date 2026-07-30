import { useState } from "react";
import { DriverAuthProvider, useDriverAuth } from "./useDriverAuth";
import DriverOnboarding from "./DriverOnboarding";
import DriverLogin from "./DriverLogin";
import DriverShell from "./DriverShell";

const ONBOARDED_KEY = "rideops_driver_onboarded";

function Gate() {
  const { session } = useDriverAuth();
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDED_KEY) === "1");

  if (!onboarded) {
    return <DriverOnboarding onDone={() => { localStorage.setItem(ONBOARDED_KEY, "1"); setOnboarded(true); }} />;
  }
  if (!session) return <DriverLogin />;
  return <DriverShell />;
}

export default function DriverApp() {
  return (
    <DriverAuthProvider>
      <Gate />
    </DriverAuthProvider>
  );
}
