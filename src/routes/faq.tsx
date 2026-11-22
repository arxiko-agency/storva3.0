import { createFileRoute } from '@tanstack/react-router';
import { PublicContent } from '@/components/public-content';
import { pageHead } from '@/lib/storva';
export const Route = createFileRoute('/faq')({
  head: () => pageHead('Questions and answers', 'Discover STORVA: build and manage your WhatsApp-first online store.'),
  component: Page,
});
function Page() { return <PublicContent page="faq" />; }
