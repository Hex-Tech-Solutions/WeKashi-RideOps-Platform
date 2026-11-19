/**
 * The live-video part of the face check (Amazon Rekognition Face Liveness).
 *
 * Kept in its own file because it pulls in the AWS component, a face-detection
 * model and Amplify's stylesheet (a few MB): DriverFaceCheck loads it lazily,
 * only when a driver actually starts a check.
 *
 * The component streams the video straight to Rekognition using the
 * short-lived, streaming-only credentials the server issued for this session.
 *
 * Amplify's stylesheet contains page-wide rules (html / body / *), so it is
 * imported as text and added as a <style> tag only while this widget is on
 * screen, instead of being bundled into the app's global CSS.
 */
import { useLayoutEffect, useState } from "react";
import { ThemeProvider } from "@aws-amplify/ui-react";
import { FaceLivenessDetectorCore } from "@aws-amplify/ui-react-liveness";
import uiCss from "@aws-amplify/ui-react/styles.css?inline";
import livenessCss from "@aws-amplify/ui-react-liveness/styles.css?inline";
import type { LivenessSession } from "@/lib/queries";

export interface LivenessFailure {
  /** Amplify's error state, e.g. CAMERA_ACCESS_ERROR, TIMEOUT, MOBILE_LANDSCAPE_ERROR. */
  state: string;
}

export default function LivenessWidget({
  session,
  onAnalysisComplete,
  onError,
  onCancel,
}: {
  session: LivenessSession;
  onAnalysisComplete: () => void | Promise<void>;
  onError: (e: LivenessFailure) => void;
  onCancel: () => void;
}) {
  const [styled, setStyled] = useState(false);
  useLayoutEffect(() => {
    const el = document.createElement("style");
    el.setAttribute("data-liveness-styles", "1");
    el.textContent = `${uiCss}\n${livenessCss}`;
    document.head.appendChild(el);
    setStyled(true);
    return () => el.remove();
  }, []);
  if (!styled) return null;

  const { credentials } = session;
  return (
    <ThemeProvider>
      <FaceLivenessDetectorCore
        sessionId={session.sessionId}
        region={session.region}
        onAnalysisComplete={async () => { await onAnalysisComplete(); }}
        onError={(e) => onError({ state: String(e.state) })}
        onUserCancel={onCancel}
        config={{
          credentialProvider: async () => ({
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
            expiration: new Date(credentials.expiration),
          }),
        }}
      />
    </ThemeProvider>
  );
}
