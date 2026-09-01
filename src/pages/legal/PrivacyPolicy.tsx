import { LegalLayout, Section } from "./LegalLayout";
import { BUSINESS } from "@/lib/businessInfo";

/**
 * The data categories listed here reflect what the platform actually collects
 * (employee roster + home coordinates, driver KYC documents, GPS traces, OTP
 * verification records, payment references). Keep this page in step with the
 * schema — an inaccurate privacy policy is worse than none.
 */
export default function PrivacyPolicy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={`This policy explains what personal information ${BUSINESS.tradeName} collects through the ${BUSINESS.productName} platform, why we collect it, who we share it with, and the rights available to you. It applies to our website and our driver application.`}
    >
      <Section heading="Who is responsible for your data">
        <p>
          {BUSINESS.tradeName}, a {BUSINESS.entityType.toLowerCase()} operated by{" "}
          {BUSINESS.legalName}, is the data fiduciary for the information described here.
        </p>
        <p>
          One important distinction: employee details are uploaded to the platform by the{" "}
          <strong>employer</strong> (our client company), not by the employees themselves. For that
          data, the employer decides what is collected and why, and we process it on their instruction.
          Employees who want their records corrected or removed should approach their employer's
          transport supervisor first, though they may also contact us directly.
        </p>
      </Section>

      <Section heading="Information we collect">
        <p>
          <strong>Supervisor and vendor accounts.</strong> Name, work email address, phone number,
          organisation name, office address and location, and a hashed password. We never store
          passwords in readable form.
        </p>
        <p>
          <strong>Employee records, uploaded by the employer.</strong> Name, employee ID, gender, phone
          number, home address and its map coordinates, office location, and shift timings. Gender is
          collected for one purpose only: to apply women's safety rules, described below.
        </p>
        <p>
          <strong>Driver accounts.</strong> Name, phone number, alternate phone number, driving licence
          number and expiry, government identity number, vehicle details, and uploaded verification
          documents. We also store bank account or UPI details, used solely to pay drivers their
          earnings.
        </p>
        <p>
          <strong>Location data.</strong> While a driver is marked online, the driver application shares
          the vehicle's GPS position so supervisors can track an active trip and so we can calculate
          arrival estimates. Location is collected from the <strong>driver's device only</strong>. We do
          not track employees' phones, and employees do not install any application.
        </p>
        <p>
          <strong>Trip records.</strong> Pickup and drop points, route taken, timestamps, OTP
          verification events for boarding and drop-off, distance, fare, no-show markings, and any
          safety incident or complaint raised.
        </p>
        <p>
          <strong>Payment data.</strong> Transaction references, amounts, and payment status. Card
          numbers, UPI PINs, net-banking credentials and similar payment secrets are entered directly
          with our payment gateway and are <strong>never</strong> transmitted to or stored on our
          servers.
        </p>
        <p>
          <strong>Technical data.</strong> IP address, browser and device information, and server logs,
          used for security, abuse prevention and diagnosing faults.
        </p>
      </Section>

      <Section heading="Why we collect it">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>To plan routes, group employees travelling together, and dispatch a suitable vehicle</li>
          <li>To verify the right passenger boards and is dropped at the right place, using OTPs</li>
          <li>To let a supervisor track an active trip and see accurate arrival estimates</li>
          <li>
            To apply women's safety rules — for example, avoiding a lone female passenger on the first
            pickup or last drop of a journey, and assigning a chaperone where required
          </li>
          <li>To verify driver identity, licences and vehicle documents before allowing them to work</li>
          <li>To calculate fares, collect payment, and pay drivers their earnings</li>
          <li>To investigate safety incidents, complaints and billing disputes</li>
          <li>To meet legal, tax and regulatory obligations</li>
        </ul>
        <p>
          We do <strong>not</strong> sell personal information, and we do not use it for third-party
          advertising or profiling.
        </p>
      </Section>

      <Section heading="Who we share it with">
        <p>
          <strong>Drivers</strong> see only what is needed to complete an assigned trip: the passenger's
          name, pickup or drop point, and a contact number. For female passengers the contact shown is
          the supervisor's number, not the employee's personal number. Drivers cannot browse your
          employee roster.
        </p>
        <p>
          <strong>Transport vendors</strong> see their own drivers, vehicles and trip earnings. They do{" "}
          <strong>not</strong> see employee personal details.
        </p>
        <p>
          <strong>Client employers</strong> see their own employees, bookings and trip history, and see
          driver contact details only once a driver has accepted one of their rides.
        </p>
        <p>
          <strong>Service providers.</strong> We share the minimum necessary with our payment gateway
          (to process payments and driver payouts), our mapping provider (coordinates, to calculate
          routes and estimates), our SMS provider (phone number and OTP, to send trip messages), and our
          cloud hosting and storage providers.
        </p>
        <p>
          <strong>Legal disclosure.</strong> We may disclose information where required by law, or to a
          law enforcement authority in connection with a safety incident.
        </p>
      </Section>

      <Section heading="How we protect it">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>All traffic between your browser or device and our servers is encrypted in transit</li>
          <li>Passwords are stored only as salted one-way hashes</li>
          <li>
            Access is restricted by role, so a vendor cannot reach employee data and a driver can reach
            only their own assigned trips
          </li>
          <li>Verification documents are held in access-controlled storage, not public URLs</li>
          <li>Sensitive actions are rate-limited and logged</li>
        </ul>
        <p>
          No system is completely secure. If a breach affecting your personal data occurs, we will notify
          affected users and the relevant authority as required by law.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          Account and employee records are retained while the account is active. Trip and payment records
          are retained for at least eight years, as required by Indian tax and accounting rules. Driver
          verification documents are retained while the driver is active on the network and for a
          reasonable period afterwards, to resolve any subsequent dispute. Raw GPS traces are retained
          for a shorter operational period and then aggregated or deleted.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          You may ask us to give you a copy of the personal data we hold about you, correct anything
          inaccurate, delete data we no longer have a lawful reason to keep, or withdraw a consent you
          previously gave. Drivers can withdraw location sharing at any time by going offline in the
          application, though they will not receive ride requests while offline.
        </p>
        <p>
          To exercise any of these, email{" "}
          <a href={`mailto:${BUSINESS.support.email}`} className="text-gold-dark hover:underline">
            {BUSINESS.support.email}
          </a>
          . We respond within 30 days. Requests that would conflict with a legal retention obligation —
          deleting an invoice we are required to keep, for instance — may be refused, and we will explain
          why.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          The platform is intended for business use by adults. We do not knowingly create accounts for
          anyone under 18.
        </p>
      </Section>

      <Section heading="Cookies">
        <p>
          We use only essential cookies and equivalent browser storage, to keep you signed in and to keep
          your session secure. We do not use advertising or cross-site tracking cookies.
        </p>
      </Section>

      <Section heading="Changes to this policy">
        <p>
          If we change this policy we will update the date at the top of this page, and notify account
          holders by email where the change is significant.
        </p>
      </Section>

      <Section heading="Grievance Officer">
        <p>
          In accordance with the Information Technology Act, 2000 and the Consumer Protection
          (E-Commerce) Rules, 2020, our Grievance Officer is:
        </p>
        <p>
          <strong>{BUSINESS.grievanceOfficer.name}</strong>
          <br />
          {BUSINESS.tradeName}
          <br />
          <a
            href={`mailto:${BUSINESS.grievanceOfficer.email}`}
            className="text-gold-dark hover:underline"
          >
            {BUSINESS.grievanceOfficer.email}
          </a>
        </p>
        <p>
          Complaints are acknowledged within 2 working days and resolved within 30 days of receipt. This
          policy is governed by the laws of India, and disputes are subject to the exclusive jurisdiction
          of the courts at {BUSINESS.jurisdictionCity}, {BUSINESS.address.state}.
        </p>
      </Section>
    </LegalLayout>
  );
}
