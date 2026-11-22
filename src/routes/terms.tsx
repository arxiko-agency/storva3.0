import { createFileRoute } from '@tanstack/react-router';
import { LegalPage } from '@/components/legal-page';
import { pageHead } from '@/lib/storva';

export const Route = createFileRoute('/terms')({
  head: () => pageHead('Terms & Conditions', 'The terms for using STORVA.'),
  component: Page,
});

const sections: [string, string][] = [
  ['1. Using the service', 'STORVA lets merchants create and run an online store. By creating an account you confirm that you are at least 18 years old, that the details you provide are accurate, and that you accept these Terms.'],
  ['2. Your account', 'You are responsible for keeping your login secure and for all activity under your account.'],
  ['3. Your store and content', 'You own the products, images and text you upload. You allow us to host and display them to operate your store. You must not sell illegal, counterfeit or prohibited goods, and you are responsible for tax, shipping, returns and consumer-law compliance for your sales.'],
  ['4. Payments', 'Customer payments are processed by Razorpay. We do not store card or UPI credentials. Payment-provider fees and settlement timelines are set by the provider. Subscription fees for paid plans are billed on a recurring basis until you cancel.'],
  ['5. Plans and cancellation', 'Each plan has the limits shown on the pricing page. If a paid subscription expires or a payment fails, paid features may be restricted until it is renewed. You can cancel at any time from the dashboard; access continues until the end of the paid period.'],
  ['6. Acceptable use', 'Do not misuse the service, attempt to access other merchants’ data, interfere with its operation, or send spam. We may suspend accounts that violate these Terms.'],
  ['7. Availability and liability', 'We work to keep the service available but do not guarantee uninterrupted operation. To the extent permitted by law, our liability is limited to the fees you paid us in the three months before the claim.'],
  ['8. Changes', 'We may update these Terms. Material changes will be announced in the dashboard or by email. Continued use after a change means you accept it.'],
];
function Page() { return <LegalPage eyebrow="LEGAL" title="Terms & Conditions" intro="The simple rules for using STORVA." sections={sections} />; }
