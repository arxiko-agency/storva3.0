import { createServerFn } from '@tanstack/react-start';
import { normalizePlans, PLAN_COLUMNS } from './public-plans';

/**
 * Public plans for the pricing section. Read on the server with the anonymous client (RLS: "plans readable"),
 * so pricing does not depend on the browser being able to reach the database directly.
 */
export const getPublicPlans = createServerFn({ method: 'GET' }).handler(async () => {
  const { publicDb } = await import('./public-db.server');
  const { data, error } = await publicDb().from('plans').select(PLAN_COLUMNS).order('sort');
  if (error) throw new Error('Could not load plans.');
  return normalizePlans(data);
});
