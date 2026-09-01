import { LegalLayout, Section } from "./LegalLayout";
import { BUSINESS } from "@/lib/businessInfo";

export default function Terms() {
  return (
    <LegalLayout
      title="Terms of Service"
      intro={`These terms govern use of the ${BUSINESS.productName} platform, operated by ${BUSINESS.tradeName}. By creating an account or booking a ride, you agree to them.`}
    >
      <Section heading="Who may use the platform">
        <p>
          The platform is for business use. Accounts are created for transport supervisors at client
          companies, for transport vendors, and for drivers working through those vendors. Accounts are
          approved by us before they become active, and we may decline or withdraw an approval.
        </p>
        <p>
          You are responsible for keeping your login credentials secure and for activity carried out
          under your account.
        </p>
      </Section>

      <Section heading="What we provide, and what we do not">
        <p>
          We provide a platform that connects a company's transport supervisor with drivers and
          transport vendors, together with routing, tracking and settlement tools.
        </p>
        <p>
          Transportation itself is performed by independent drivers and vendors. They are not our
          employees. We verify driver documents and vehicle papers before allowing a driver onto the
          network, but we do not control how a driver drives on a given day.
        </p>
      </Section>

      <Section heading="Bookings and fares">
        <p>
          A booking is a request until a driver accepts it. We do not guarantee that a driver will be
          available for any particular request, particularly outside our operating area or at short
          notice.
        </p>
        <p>
          The fare is calculated from distance, vehicle class and any applicable surcharge, and is shown
          before a booking is broadcast. A supervisor may optionally add a top-up amount for the driver.
          The full breakdown is shown again after the trip, before payment is authorised.
        </p>
        <p>
          Payment is due after a trip is completed. No amount is collected in advance. Fees and
          cancellation charges are set out in our{" "}
          <a href="/refund-policy" className="text-gold-dark hover:underline">
            Refund &amp; Cancellation Policy
          </a>
          .
        </p>
      </Section>

      <Section heading="Obligations of client companies">
        <p>
          You confirm that you are entitled to upload your employees' details — including home addresses
          and phone numbers — for the purpose of arranging their transport, and that you have informed
          them accordingly. You must keep those records accurate, and remove employees who leave.
        </p>
        <p>You must not use the platform to transport anyone other than the employees you have booked for.</p>
      </Section>

      <Section heading="Obligations of drivers and vendors">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Hold a valid driving licence, vehicle registration, insurance, permit and fitness certificate, and keep them current on the platform</li>
          <li>Verify boarding and drop-off using the OTP process, and not bypass it</li>
          <li>Complete an accepted trip, or release it with as much notice as possible</li>
          <li>Follow all applicable traffic and transport law</li>
          <li>Treat passengers respectfully and follow the safety rules the platform applies, including chaperone requirements</li>
        </ul>
        <p>
          Fees may apply where a scheduled ride is released at short notice or not performed after being
          accepted. These are deducted from your earnings balance and are itemised in the application.
        </p>
      </Section>

      <Section heading="Driver earnings and payouts">
        <p>
          Fares and chaperone charges accrue to a driver's in-app earnings balance once the supervisor's
          payment is confirmed. A driver may request a transfer to their registered bank account or UPI
          ID. A transfer fee applies and is shown before the request is confirmed.
        </p>
        <p>
          Where a fee has been charged, the balance may be negative, and transfers are unavailable until
          subsequent earnings clear it.
        </p>
      </Section>

      <Section heading="Prohibited conduct">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Submitting false documents, or documents belonging to someone else</li>
          <li>Allowing another person to drive using your account</li>
          <li>Manipulating GPS or trip data, or falsifying OTP verification</li>
          <li>Attempting to gain access to data belonging to another account</li>
          <li>Interfering with, overloading, or reverse-engineering the platform</li>
          <li>Contacting passengers for any purpose unrelated to an assigned trip</li>
        </ul>
        <p>We may suspend or terminate an account for any of the above.</p>
      </Section>

      <Section heading="Safety">
        <p>
          The platform applies rules intended to protect women passengers, including restrictions on
          leaving a lone female passenger as the first pickup or last drop of a journey, and requiring a
          chaperone in certain circumstances. Drivers and supervisors must not attempt to work around
          these rules.
        </p>
        <p>
          The driver application includes an emergency function. In a genuine emergency, contact the
          police on 112 first.
        </p>
      </Section>

      <Section heading="Liability">
        <p>
          The platform is provided on an "as is" basis. We do not warrant uninterrupted availability, and
          arrival estimates are indicative — they depend on traffic and other conditions outside our
          control.
        </p>
        <p>
          To the extent permitted by law, our total liability for any claim relating to a trip is limited
          to the fare paid for that trip. We are not liable for indirect or consequential loss, including
          lost business or missed working hours.
        </p>
        <p>Nothing in these terms excludes liability that cannot lawfully be excluded.</p>
      </Section>

      <Section heading="Suspension and termination">
        <p>
          You may stop using the platform at any time and ask us to close your account. Amounts already
          due remain payable. We may suspend or close an account for breach of these terms, for a safety
          concern, for non-payment, or where documents have expired.
        </p>
      </Section>

      <Section heading="Changes to these terms">
        <p>
          We may update these terms. The date at the top of this page reflects the current version, and
          we will notify account holders by email where a change is significant. Continuing to use the
          platform after a change means you accept the updated terms.
        </p>
      </Section>

      <Section heading="Governing law">
        <p>
          These terms are governed by the laws of India. Disputes are subject to the exclusive
          jurisdiction of the courts at {BUSINESS.jurisdictionCity}, {BUSINESS.address.state}.
        </p>
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${BUSINESS.support.email}`} className="text-gold-dark hover:underline">
            {BUSINESS.support.email}
          </a>
          . Complaints: {BUSINESS.grievanceOfficer.name} at{" "}
          <a
            href={`mailto:${BUSINESS.grievanceOfficer.email}`}
            className="text-gold-dark hover:underline"
          >
            {BUSINESS.grievanceOfficer.email}
          </a>
          .
        </p>
      </Section>
    </LegalLayout>
  );
}
