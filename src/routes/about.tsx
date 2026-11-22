import { createFileRoute } from '@tanstack/react-router';
import { PublicContent } from '@/components/public-content';
import { pageHead } from '@/lib/storva';
export const Route = createFileRoute('/about')({
  head: () => pageHead('About', 'Discover STORVA: build and manage your WhatsApp-first online store.'),
  component: Page,
});
function Page() { return <PublicContent page="about" />; }
