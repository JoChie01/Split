/**
 * Privacy.tsx
 *
 * WHAT: The privacy notice, shown at /privacy. The sign-up checkbox links here.
 * RULE: Every statement must match what the app really does. When the code changes
 *       (what is stored, who can see it, how long it is kept), change this text too.
 */
import { Brand } from "./Auth";
import "./privacy.css";

export function Privacy() {
  return (
    <main className="page privacy">
      <Brand />
      <h1>Privacy <mark>notice</mark></h1>
      <p className="privacy-meta">Last updated: 5 November 2026</p>

      <h2>Who runs Split</h2>
      <p>
        Split is run by John Christian B. Angaga. Questions about your data go to{" "}
        <a href="mailto:christianangaga@gmail.com">christianangaga@gmail.com</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Your name and email address, and the time you agreed to this notice.</li>
        <li>Bills in the groups you join, and your share of each bill.</li>
        <li>Payments you record: the reference number, amount, status and date.</li>
        <li>Receipt images you attach (PNG or JPEG).</li>
        <li>
          A log of key actions in a group, such as who joined, who confirmed a payment, and when.
          It stores the action and the people involved as IDs, not names or account numbers.
        </li>
        <li>Log-in links and sessions, stored only as scrambled codes, not in readable form.</li>
      </ul>
      <p>
        We do not ask for passwords or for your bank or e-wallet account numbers. A receipt image can
        still show account details, which is why we delete receipts soon after a payment is confirmed.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To create your account and let you log in.</li>
        <li>To split bills and show who owes and who has paid.</li>
        <li>To let the person receiving a payment check the receipt and confirm or dispute it.</li>
        <li>To keep a record in case there is a disagreement about a payment.</li>
        <li>
          To stop abuse, such as someone flooding an inbox with log-in emails. Your IP address is held
          briefly in the server memory to count repeated requests.
        </li>
      </ul>

      <h2>Who can see it</h2>
      <p>
        Everyone in your group can see the bills and payments of that group, and can open the receipt
        images attached to those payments. We do not sell your data.
      </p>
      <p>Some services help us run Split:</p>
      <ul>
        <li>Resend sends our log-in emails, so it receives your email address.</li>
        <li>Google Fonts supplies the page fonts, so your browser contacts Google when a page loads.</li>
        <li>Split is not publicly hosted yet. We will name our hosting provider here before launch.</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Log-in links expire after 15 minutes, and each one works once.</li>
        <li>Sessions last 30 days.</li>
        <li>
          Receipts of confirmed payments are deleted automatically 3 days after the payer confirms. A
          disputed receipt is kept until the dispute is resolved.
        </li>
        <li>
          We plan to delete payment history 15 days after a bill is settled. This automatic cleanup is
          still being built.
        </li>
        <li>Your account details stay until you ask us to delete your account.</li>
        <li>The log of key actions is kept with its group.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Under the Data Privacy Act of 2012 (Republic Act 10173) you can ask to see the data we hold
        about you, correct it, object to how we use it, and have it deleted or blocked. You can also ask
        for a copy in a common format, withdraw your consent, and claim damages if your data is
        misused. To use any of these rights, write to{" "}
        <a href="mailto:christianangaga@gmail.com">christianangaga@gmail.com</a>.
      </p>
      <p>
        If you are not satisfied with our answer, you can complain to the National Privacy Commission
        at <a href="https://privacy.gov.ph" target="_blank" rel="noopener noreferrer">privacy.gov.ph</a>.
      </p>

      <h2>How we protect it</h2>
      <p>
        We limit access to group members, use one-time log-in links instead of passwords, and limit how
        often log-in links can be requested. If a data breach that could harm you happens, we will tell
        you and the National Privacy Commission within the time the law requires.
      </p>

      <h2>Changes to this notice</h2>
      <p>If we change this notice, we will update the date at the top of this page.</p>

      <p className="privacy-back">
        <a href="/signup">Back to sign-up</a>
      </p>
    </main>
  );
}
