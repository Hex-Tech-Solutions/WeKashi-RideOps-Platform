import { LegalLayout, Section } from "./LegalLayout";
import { BUSINESS } from "@/lib/businessInfo";

export default function About() {
  return (
    <LegalLayout
      title="About Us"
      intro={`${BUSINESS.productName} is a business-to-business employee transportation platform operated by ${BUSINESS.tradeName}, based in ${BUSINESS.address.city}, ${BUSINESS.address.state}.`}
    >
      <Section heading="Business category">
        <p>
          We operate in <strong>ground passenger transportation and travel services</strong> —
          specifically corporate employee commute management. Our customers are businesses, not
          individual retail consumers.
        </p>
        <p>
          We provide a software platform and dispatch service. We do not sell, ship, or deliver any
          physical goods.
        </p>
      </Section>

      <Section heading="What we do">
        <p>
          Companies run scheduled employee transport for staff commuting to and from work. When their
          regular fleet falls short — extra shifts, unplanned demand, vehicle breakdowns — we let the
          company's transport supervisor book a verified cab on demand instead of leaving employees
          stranded.
        </p>
        <p>The platform covers:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Employee roster management with home pickup locations and shift timings</li>
          <li>Automatic multi-stop route planning and grouping of employees travelling together</li>
          <li>Dispatch to a network of document-verified drivers and transport vendors</li>
          <li>Live GPS tracking, per-stop arrival estimates, and OTP-verified boarding and drop-off</li>
          <li>Women's safety controls, including chaperone (escort) assignment rules</li>
          <li>Trip records, on-time performance reporting, and per-ride settlement</li>
        </ul>
      </Section>

      <Section heading="Who uses the platform">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Transport supervisors</strong> at client companies, who book and monitor rides for
            their employees.
          </li>
          <li>
            <strong>Transport vendors</strong>, who onboard their drivers and vehicles onto the network.
          </li>
          <li>
            <strong>Drivers</strong>, who receive ride requests and complete trips.
          </li>
        </ul>
        <p>
          Employees being transported do not need an account or an app. Their supervisor manages the
          booking on their behalf.
        </p>
      </Section>

      <Section heading="How we charge">
        <p>
          There is no subscription or signup fee. A supervisor pays only for rides actually completed,
          and payment is made <strong>after</strong> the trip finishes — never in advance. Each ride
          invoice shows the driver fare, a fixed platform fee, and any applicable surcharge (such as a
          safety chaperone or air conditioning) before payment is confirmed.
        </p>
        <p>
          Drivers are paid the fare and any chaperone charge, which accrues to their in-app earnings
          balance and is transferred to their registered bank account or UPI ID on request.
        </p>
      </Section>

      <Section heading="Contact us">
        <p>
          Email{" "}
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
          . Our support hours are {BUSINESS.support.hours}.
        </p>
      </Section>
    </LegalLayout>
  );
}
