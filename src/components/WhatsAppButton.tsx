import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const WHATSAPP_URL = "https://wa.me/918050441392";

/**
 * Floating WhatsApp chat shortcut. Bottom-left on every screen, except the
 * driver app, where the bottom-left holds the tab bar: there it sits at the
 * bottom-right, just above the Account tab.
 */
export function WhatsAppButton() {
  const { pathname } = useLocation();
  const inDriverApp = pathname.startsWith("/driver");
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      title="Chat on WhatsApp"
      className={cn(
        "fixed z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] shadow-lg transition-transform hover:scale-105",
        inDriverApp
          ? "right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))]"
          : "bottom-4 left-4",
      )}
    >
      <img src="/whatsapp-logo.svg" alt="" className="h-7 w-7" draggable={false} />
    </a>
  );
}
