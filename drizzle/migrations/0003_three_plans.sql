-- STORVA: public pricing = exactly 3 plans: Free Rs 0 (25 products), Rs 249, Rs 899 per month.
-- Limits and features of each plan stay exactly as already configured, except Free's product limit.
-- Limits are enforced by database triggers that read this table, so what the pricing page shows is what is enforced.
-- Yearly price = 12 x monthly (no yearly discount is invented). Change price_yearly here if you want one.

-- 1. Nobody should be left on the plan that is being removed (none expected before launch).
UPDATE public.subscriptions SET plan_id = 'pro' WHERE plan_id = 'enterprise';
UPDATE public.subscriptions SET pending_plan_id = NULL, pending_interval = NULL WHERE pending_plan_id = 'enterprise';

-- 2. Free: 25 products (orders / storage / AI limits unchanged).
UPDATE public.plans SET product_limit = 25 WHERE id = 'free';

-- 3. Paid plans. Prices are in paise. The cached Razorpay plan ids are cleared so the first checkout
--    creates Razorpay plans at the new prices instead of reusing old ones.
UPDATE public.plans SET price_monthly = 24900, price_yearly = 298800, razorpay_plan_monthly = NULL, razorpay_plan_yearly = NULL WHERE id = 'starter';
UPDATE public.plans SET price_monthly = 89900, price_yearly = 1078800, razorpay_plan_monthly = NULL, razorpay_plan_yearly = NULL WHERE id = 'pro';

-- 4. Remove the fourth plan.
DELETE FROM public.plans WHERE id = 'enterprise';
