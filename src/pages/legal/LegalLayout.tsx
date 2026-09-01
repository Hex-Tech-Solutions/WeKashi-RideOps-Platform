/**
 * Shared shell for the public legal/policy pages.
 *
 * These pages are reachable without authentication — a payment gateway
 * reviewer (and any customer) must be able to read them directly from the
 * footer without signing in.
 */

import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { BUSINESS } from "@/lib/businessInfo";

export const LEGAL_PAGES = [
  { to: "/about", label: "About Us" },
  { to: "/privacy-policy", label: "Privacy Policy" },
  { to: "/refund-policy", label: "Refund & Cancellation" },
  { to: "/shipping-and-returns", label: "Service Delivery" },
  { to: "/terms", label: "Terms of Service" },
] as const;

export function LegalLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-gradient-gold flex items-center justify-center font-bold text-gold-foreground text-xs">
              R
            </div>
            <span className="font-bold tracking-tight">{BUSINESS.productName}</span>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-xs text-muted-foreground mt-2">
          Last updated: {BUSINESS.policiesLastUpdated}
        </p>
        {intro && <p className="mt-5 text-muted-foreground leading-relaxed">{intro}</p>}

        <div className="mt-8 space-y-8">{children}</div>

        {/* Operator identity — gateways expect this discoverable on every policy page */}
        <div className="mt-14 rounded-lg border bg-muted/30 p-5 text-sm space-y-1.5">
          <div className="font-semibold">Business details</div>
          <div className="text-muted-foreground">
            <div>
              {BUSINESS.tradeName} ({BUSINESS.entityType})
            </div>
            <div>Proprietor: {BUSINESS.legalName}</div>
            <div>GSTIN: {BUSINESS.gstin}</div>
            <div className="mt-2">
              {BUSINESS.address.line1}, {BUSINESS.address.line2},<br />
              {BUSINESS.address.city}, {BUSINESS.address.district},{" "}
              {BUSINESS.address.state} {BUSINESS.address.pincode}, {BUSINESS.address.country}
            </div>
            <div className="mt-2">
              <a href={`mailto:${BUSINESS.support.email}`} className="text-gold-dark hover:underline">
                {BUSINESS.support.email}
              </a>
              {" · "}
              <a href={`tel:${BUSINESS.support.phone.replace(/\s/g, "")}`} className="text-gold-dark hover:underline">
                {BUSINESS.support.phone}
              </a>
            </div>
          </div>
        </div>

        {/* Cross-links */}
        <nav className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground border-t pt-6">
          {LEGAL_PAGES.map((p) => (
            <Link key={p.to} to={p.to} className="hover:text-foreground transition-colors">
              {p.label}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}

/** Consistent section heading + body wrapper. */
export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}
