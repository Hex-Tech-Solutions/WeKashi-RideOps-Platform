import { LegalLayout, Section } from "./LegalLayout";
import { BUSINESS } from "@/lib/businessInfo";

/**
 * Payment gateways require a "Shipping and Return Policy" page as a standard
 * onboarding item. We sell a transportation service, not physical goods, so
 * this page states that plainly rather than pretending shipping applies.
 */
export default function ShippingAndReturns() {
  return (
    <LegalLayout
      title="Shipping, Delivery & Return Policy"
      intro={`${BUSINESS.tradeName} provides a transportation service. We do not sell, ship, or deliver physical products, so conventional shipping and product-return terms do not apply. This page explains how our service is delivered instead.`}
    >
      <Section heading="No physical goods">
        <p>
          Nothing on this platform is a physical product. We do not dispatch couriers, parcels, or
          consignments, and no shipping charges are ever levied. There is accordingly no shipping
          address to provide, no tracking consignment number, and no delivery partner involved.
        </p>
      </Section>

      <Section heading="What we deliver, and when">
        <p>
          The service we deliver is <strong>employee transportation</strong> — moving a company's
          employees between their homes and their workplace by road, using a driver and vehicle from our
          verified network.
        </p>
        <p>Service delivery works as follows:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Platform access is immediate.</strong> Once an account is approved, access to the
            booking platform is available instantly and electronically. There is nothing to ship.
          </li>
          <li>
            <strong>On-demand rides</strong> are dispatched to nearby available drivers as soon as they
            are booked. A driver typically accepts within a few minutes, after which live tracking and
            arrival estimates are shown in the platform.
          </li>
          <li>
            <strong>Scheduled rides</strong> are performed at the date and time selected by the
            supervisor at the time of booking.
          </li>
          <li>
            <strong>Service is complete</strong> when every employee on the trip has been dropped at
            their destination and confirmed by OTP verification.
          </li>
        </ul>
      </Section>

      <Section heading="Returns and exchanges">
        <p>
          Because a completed journey cannot be returned, exchanged, or restocked, product-style returns
          do not apply to our service.
        </p>
        <p>
          If a trip was not performed as booked — the driver did not arrive, the trip was abandoned
          partway, or the vehicle was unsuitable — do not treat it as a return. Report it to us and we
          will investigate and, where appropriate, adjust or waive the fare for that trip.
        </p>
        <p>
          Where money was debited without the corresponding service being delivered, our{" "}
          <a href="/refund-policy" className="text-gold-dark hover:underline">
            Refund &amp; Cancellation Policy
          </a>{" "}
          applies.
        </p>
      </Section>

      <Section heading="If a trip is not performed as booked">
        <p>
          Report the issue within <strong>7 days</strong> of the scheduled trip by emailing{" "}
          <a href={`mailto:${BUSINESS.support.email}`} className="text-gold-dark hover:underline">
            {BUSINESS.support.email}
          </a>{" "}
          with the ride reference number and a description of what happened. You can also raise it from
          the Issues section inside the platform, which attaches the trip record automatically.
        </p>
        <p>
          Since payment is only requested after a trip completes, an unfulfilled trip normally means no
          charge was raised at all. If a charge was raised in error, we correct it.
        </p>
      </Section>

      <Section heading="Service area">
        <p>
          We currently operate in and around {BUSINESS.address.city}, {BUSINESS.address.state}, India.
          Rides are accepted only where a verified driver is available within range of the requested
          pickup point. Availability outside our operating area cannot be guaranteed.
        </p>
      </Section>

      <Section heading="Questions">
        <p>
          Contact{" "}
          <a href={`mailto:${BUSINESS.support.email}`} className="text-gold-dark hover:underline">
            {BUSINESS.support.email}
          </a>{" "}
          or call{" "}
          <a
            href={`tel:${BUSINESS.support.phone.replace(/\s/g, "")}`}
            className="text-gold-dark hover:underline"
          >
            {BUSINESS.support.phone}
          </a>
          . Support hours are {BUSINESS.support.hours}.
        </p>
      </Section>
    </LegalLayout>
  );
}
