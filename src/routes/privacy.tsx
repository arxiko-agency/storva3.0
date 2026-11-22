import { createFileRoute } from '@tanstack/react-router';
import { LegalPage } from '@/components/legal-page';
import { pageHead } from '@/lib/storva';

export const Route = createFileRoute('/privacy')({
  head: () => pageHead('Privacy Policy', 'How STORVA collects, uses and protects your information.'),
  component: Page,
});

const sections: [string, string][] = [
  ['1. What we collect', 'Account details (name, mobile number, email), store and product information you enter, order and customer details placed through your store, and technical data such as IP address and device type for security and analytics.'],
  ['2. How we use it', 'To provide and secure the service, process orders and payments, send order notifications, provide AI features you request, and meet legal obligations.'],
  ['3. Customers of your store', 'For orders placed on a merchant’s store, the merchant is the controller of their customers’ data and we process it on their behalf. Customers should contact the merchant about their orders.'],
  ['4. Service providers', 'We share only what is needed with the providers that run the service, such as hosting and database, payments (Razorpay), messaging (including WhatsApp) and AI generation. Card and UPI details are handled by Razorpay and never stored by us.'],
  ['5. Retention and security', 'Data is encrypted in transit. We keep account data while your account is active and delete or anonymise it on request, except where law requires us to retain records such as invoices.'],
  ['6. Your rights', 'You can access, correct, export or delete your personal data by contacting us. You can withdraw consent for marketing messages at any time.'],
];
function Page() { return <LegalPage eyebrow="LEGAL" title="Privacy Policy" intro="How we handle your information, in plain language." sections={sections} />; }
