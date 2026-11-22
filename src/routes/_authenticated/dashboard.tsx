import { createFileRoute } from '@tanstack/react-router';
import { StoreShell } from '@/components/store-shell';
import { DashboardOverview } from '@/components/dashboard-overview';
import { pageHead } from '@/lib/storva';

export const Route = createFileRoute('/_authenticated/dashboard')({
  head: () => pageHead('Your store dashboard', 'Manage your STORVA store, products, orders and subscription in one place.'),
  component: () => <StoreShell><DashboardOverview /></StoreShell>,
});
