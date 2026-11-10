import { createContext, useContext } from "react";

/**
 * Lets a component inside a modal Sheet/Dialog get out of the way of an
 * external checkout overlay (Cashfree).
 *
 * Radix modal dialogs set `pointer-events: none` on everything outside their
 * content, lock touch scrolling and trap focus. The Cashfree checkout is
 * appended to <body>, outside the dialog, so while the dialog is open the
 * checkout renders but cannot be tapped. The host closes itself in
 * `beginCheckout` and reopens in `endCheckout`.
 *
 * Outside a provider these are no-ops, so the card still works standalone.
 */
export interface ExternalCheckoutHost {
  beginCheckout: () => void;
  endCheckout: () => void;
}

const noop = () => {};

export const ExternalCheckoutContext = createContext<ExternalCheckoutHost>({
  beginCheckout: noop,
  endCheckout: noop,
});

export const useExternalCheckoutHost = () => useContext(ExternalCheckoutContext);
