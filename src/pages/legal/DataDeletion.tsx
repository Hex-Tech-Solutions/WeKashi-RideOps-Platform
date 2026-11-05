import { LegalLayout, Section } from "./LegalLayout";
import { BUSINESS } from "@/lib/businessInfo";

/**
 * Dedicated account/data-deletion page.
 *
 * Google Play's Data Safety form requires a "Delete data URL" that (1) names
 * the app/developer, (2) prominently lists the steps a user takes to request
 * deletion, and (3) states what is deleted vs retained and for how long. This
 * page exists specifically to satisfy those three requirements; keep it in
 * step with the Privacy Policy's retention section.
 */
export default function DataDeletion() {
  return (
    <LegalLayout
      title="Delete Your Account & Data"
      intro={`This page explains how to request deletion of the personal data that ${BUSINESS.tradeName} holds about you through the ${BUSINESS.productName} driver application, what we delete, and what we are required to keep.`}
    >
      <Section heading="Who this applies to">
        <p>
          The {BUSINESS.productName} driver app is operated by {BUSINESS.tradeName} (
          {BUSINESS.entityType}), proprietor {BUSINESS.legalName}. Drivers sign in to an account that
          their transport vendor created for them; the app itself does not let a driver self-register.
          You can ask us to delete your driver account and the personal data associated with it at any
          time using the steps below.
        </p>
      </Section>

      <Section heading="How to request deletion">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Send an email to{" "}
            <a href={`mailto:${BUSINESS.support.email}`} className="text-gold-dark hover:underline">
              {BUSINESS.support.email}
            </a>{" "}
            from the email address or using the phone number registered on your driver account.
          </li>
          <li>
            Use the subject line <strong>&ldquo;Delete my data&rdquo;</strong>.
          </li>
          <li>
            In the message, include the <strong>phone number</strong> registered on your{" "}
            {BUSINESS.productName} driver account so we can locate it.
          </li>
          <li>
            We acknowledge your request within <strong>2 working days</strong> and complete verified
            deletions within <strong>30 days</strong>, then email you to confirm.
          </li>
        </ol>
        <p>
          You can also call us on{" "}
          <a
            href={`tel:${BUSINESS.support.phone.replace(/\s/g, "")}`}
            className="text-gold-dark hover:underline"
          >
            {BUSINESS.support.phone}
          </a>{" "}
          ({BUSINESS.support.hours}) to start a request. We may ask a verification question to confirm
          you own the account before we delete anything.
        </p>
      </Section>

      <Section heading="What gets deleted">
        <p>On a verified request, we delete the personal data tied to your driver account, including:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Your name, phone number and alternate phone number</li>
          <li>Your driving licence number, government identity number and uploaded verification documents</li>
          <li>Your saved UPI ID</li>
          <li>Your device&rsquo;s push-notification (FCM) token</li>
          <li>Your stored GPS location records that are not part of a billed trip</li>
          <li>Your login sessions and app preferences</li>
        </ul>
      </Section>

      <Section heading="What we keep, and for how long">
        <p>
          Some records cannot be deleted immediately because Indian tax, accounting and safety law
          requires us to retain them. These are kept only as long as the law requires and are then
          deleted or anonymised:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Trip and payment records</strong> (fares, transaction references, invoices) — retained
            for at least <strong>eight years</strong> to meet tax and accounting obligations.
          </li>
          <li>
            <strong>Safety-incident and complaint records</strong> — retained for the period needed to
            resolve any dispute or legal claim.
          </li>
          <li>
            Where a record must be kept, we remove or mask the personal identifiers that are not legally
            required, so the retained entry holds the minimum necessary.
          </li>
        </ul>
        <p>
          Note that some driver records are held on behalf of your transport vendor. If a legal
          retention obligation prevents immediate deletion of a specific item, we will tell you which
          item and why in our confirmation email.
        </p>
      </Section>

      <Section heading="Related">
        <p>
          For the full picture of what we collect and why, see our{" "}
          <a href="/privacy-policy" className="text-gold-dark hover:underline">
            Privacy Policy
          </a>
          . Deletion requests that would conflict with a legal retention obligation may be partially
          refused, and we will always explain which data we kept and for how long.
        </p>
      </Section>
    </LegalLayout>
  );
}
