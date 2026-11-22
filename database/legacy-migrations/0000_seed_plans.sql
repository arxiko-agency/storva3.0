insert into public.plans (id, name, price_monthly, price_yearly, product_limit, order_limit, storage_mb, ai_limit, trial_days, features, sort) values
  ('free', 'Free', 0, 0, 10, 50, 100, 20, 0, '["basic_ai"]'::jsonb, 0),
  ('starter', 'Starter', 49900, 499000, 100, 500, 1024, 200, 14, '["basic_ai","image_ai"]'::jsonb, 1),
  ('pro', 'Pro', 149900, 1499000, 1000, 5000, 10240, 1000, 14, '["basic_ai","image_ai","marketing_ai"]'::jsonb, 2),
  ('enterprise', 'Enterprise', 499900, 4999000, null, null, 102400, 5000, 14, '["basic_ai","image_ai","marketing_ai","recommendations"]'::jsonb, 3)
on conflict (id) do update set
  name = excluded.name,
  price_monthly = excluded.price_monthly,
  price_yearly = excluded.price_yearly,
  product_limit = excluded.product_limit,
  order_limit = excluded.order_limit,
  storage_mb = excluded.storage_mb,
  ai_limit = excluded.ai_limit,
  trial_days = excluded.trial_days,
  features = excluded.features,
  sort = excluded.sort;