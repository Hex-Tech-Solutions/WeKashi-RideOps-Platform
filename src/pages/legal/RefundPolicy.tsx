import { LegalLayout, Section } from "./LegalLayout";
import { BUSINESS } from "@/lib/businessInfo";

export default function RefundPolicy() {
  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      intro="Payment on our platform is collected only after a trip is completed. Because nothing is charged upfront, refunds arise in a narrow set of circumstances — almost always a payment that was debited but did not complete successfully. This policy explains exactly when a refund applies and how to claim one."
    >
      <Section heading="How payment works on this platform">
        <p>
          A supervisor books a ride at no charge. No amount is collected at booking, and no advance,
          deposit, or wallet top-up is required.
        </p>
        <p>
          Payment is requested only <strong>after the trip is completed</strong>. The supervisor reviews
          the fare breakdown — driver fare, platform fee, and any applicable surcharge — and then
          authorises payment. Nothing is collected until that point.
        </p>
        <p>
          As a result, a cancelled or unfulfilled ride does not need a refund, because no money was
          taken for it in the first place.
        </p>
      </Section>

      <Section heading="When a refund applies">
        <p>Refunds are issued in the following cases:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Amount debited but the payment did not complete.</strong> Money left your bank or
            card but the ride was not marked as paid on our platform. If the funds reached our payment
            gateway, we refund them in full.
          </li>
          <li>
            <strong>Duplicate payment for the same ride.</strong> If a ride was paid for more than once
            — for example, a retry after a timeout — the extra amount is refunded in full.
          </li>
          <li>
            <strong>Amount charged in excess of the confirmed invoice.</strong> If the amount captured
            exceeds the total shown at the time of authorisation, the difference is refunded.
          </li>
          <li>
            <strong>Payment collected for a trip that did not take place.</strong> If a billing error
            resulted in a charge for a ride that was never performed, the full amount is refunded.
          </li>
        </ul>
      </Section>

      <Section heading="When a refund does not apply">
        <p>
          <strong>Cancelled rides.</strong> Cancelling a ride costs nothing at the time of
          cancellation. Where a cancellation charge applies (see below), it is a fee — not a captured
          payment — so there is nothing to refund.
        </p>
        <p>
          <strong>Completed trips.</strong> Once a trip has been performed and the fare paid, the
          service has been delivered and the payment is not refundable. If you believe a completed trip
          was billed incorrectly, raise a dispute using the process below and we will investigate.
        </p>
        <p>
          <strong>Employee absence.</strong> If an employee does not travel but the vehicle was
          dispatched and the trip performed, the fare remains payable, since the driver completed the
          assigned work.
        </p>
        <p>
          <strong>Failed payments where no money was captured.</strong> If a transaction failed and your
          bank never completed the debit, there is nothing for us to refund. Amounts placed on temporary
          hold by your bank are released by the bank directly, typically within 5 to 7 working days.
        </p>
      </Section>

      <Section heading="Cancellation charges">
        <p>
          These are fees, not refundable payments. They are listed here for transparency.
        </p>
        <p>
          <strong>Supervisors.</strong> Cancelling a ride before a driver has been assigned is free. If
          a driver has already been assigned and is en route, a cancellation fee of 5% of the ride fare
          applies. This fee is not collected at the time of cancellation — it is added to your next
          booking invoice, where it is shown as a separate line item before you authorise payment.
          Cancellations arising from a safety incident are not charged.
        </p>
        <p>
          <strong>Drivers.</strong> Drivers who accept a scheduled ride and later release it are charged
          a fee based on the notice given, which is deducted from their earnings balance. Declining a
          ride request carries no charge.
        </p>
      </Section>

      <Section heading="How to request a refund">
        <p>
          Email{" "}
          <a href={`mailto:${BUSINESS.support.email}`} className="text-gold-dark hover:underline">
            {BUSINESS.support.email}
          </a>{" "}
          with:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>The ride reference number, visible in your Payments screen</li>
          <li>The amount debited and the date of the transaction</li>
          <li>The payment reference or transaction ID from your bank or card statement</li>
          <li>A screenshot of the bank or card statement entry, if available</li>
        </ul>
        <p>
          Please raise refund requests within <strong>30 days</strong> of the transaction date. Requests
          made after this period may not be verifiable against gateway records.
        </p>
      </Section>

      <Section heading="Processing time and method">
        <p>
          We acknowledge refund requests within <strong>2 working days</strong> and verify the
          transaction against our payment gateway records. Where a refund is due, it is initiated within{" "}
          <strong>{BUSINESS.refundTurnaroundDays} working days</strong> of approval.
        </p>
        <p>
          Refunds are issued <strong>only to the original payment method</strong> used for the
          transaction. We do not issue refunds in cash, to a different account, or as platform credit
          against future bookings.
        </p>
        <p>
          Once initiated, the time for the amount to appear in your account depends on your bank or card
          issuer, and is typically a further 5 to 7 working days. We will share the refund reference
          number so you can follow up with your bank if needed.
        </p>
        <p>
          We do not deduct any processing charge from refunds. Payment gateway fees on the original
          transaction, where applicable, are borne by us.
        </p>
      </Section>

      <Section heading="Grievance redressal">
        <p>
          If your refund request is not resolved to your satisfaction, escalate to our Grievance
          Officer, {BUSINESS.grievanceOfficer.name}, at{" "}
          <a
            href={`mailto:${BUSINESS.grievanceOfficer.email}`}
            className="text-gold-dark hover:underline"
          >
            {BUSINESS.grievanceOfficer.email}
          </a>
          . Escalated complaints are acknowledged within 2 working days and resolved within 30 days of
          receipt.
        </p>
        <p>
          This policy is governed by the laws of India, and disputes are subject to the exclusive
          jurisdiction of the courts at {BUSINESS.jurisdictionCity}, {BUSINESS.address.state}.
        </p>
      </Section>
    </LegalLayout>
  );
}
