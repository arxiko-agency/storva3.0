
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ======================= Module 7: store designer =======================
CREATE TABLE public.store_themes (
  owner_id uuid PRIMARY KEY,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  published jsonb,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_themes_draft_size CHECK (pg_column_size(draft) < 200000),
  CONSTRAINT store_themes_published_size CHECK (published IS NULL OR pg_column_size(published) < 200000)
);
GRANT SELECT, INSERT, UPDATE ON public.store_themes TO authenticated;
GRANT ALL ON public.store_themes TO service_role;
ALTER TABLE public.store_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own theme read" ON public.store_themes FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own theme insert" ON public.store_themes FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own theme update" ON public.store_themes FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TABLE public.theme_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_versions_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT theme_versions_size CHECK (pg_column_size(config) < 200000)
);
CREATE INDEX theme_versions_owner_idx ON public.theme_versions (owner_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.theme_versions TO authenticated;
GRANT ALL ON public.theme_versions TO service_role;
ALTER TABLE public.theme_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own versions read" ON public.theme_versions FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own versions insert" ON public.theme_versions FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own versions delete" ON public.theme_versions FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.trim_theme_versions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.theme_versions WHERE owner_id = new.owner_id AND id IN (
    SELECT id FROM public.theme_versions WHERE owner_id = new.owner_id ORDER BY created_at DESC OFFSET 30);
  RETURN NULL;
END $$;
CREATE TRIGGER theme_versions_trim AFTER INSERT ON public.theme_versions FOR EACH ROW EXECUTE FUNCTION public.trim_theme_versions();

ALTER TABLE public.products
  ADD COLUMN compare_at_price numeric(12,2),
  ADD COLUMN hsn_code text,
  ADD COLUMN gst_rate numeric(5,2),
  ADD CONSTRAINT products_compare_price_check CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
  ADD CONSTRAINT products_hsn_check CHECK (hsn_code IS NULL OR hsn_code ~ '^[0-9]{4,8}$'),
  ADD CONSTRAINT products_gst_rate_check CHECK (gst_rate IS NULL OR gst_rate IN (0, 0.25, 3, 5, 12, 18, 28)),
  ADD CONSTRAINT products_image_path_check CHECK (image_path IS NULL OR image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$');

-- Product photo storage (private bucket): owners write/read only inside their own folder; shoppers get signed links from the server.
CREATE POLICY "merchant images insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "merchant images update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "merchant images delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "merchant images read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ======================= Module 12: shipping & GST =======================
CREATE TABLE public.store_commerce_settings (
  owner_id uuid PRIMARY KEY,
  legal_name text NOT NULL DEFAULT '',
  gstin text,
  business_address text NOT NULL DEFAULT '',
  business_state text NOT NULL DEFAULT '',
  gst_enabled boolean NOT NULL DEFAULT false,
  prices_include_gst boolean NOT NULL DEFAULT true,
  default_gst_rate numeric(5,2) NOT NULL DEFAULT 18,
  invoice_prefix text NOT NULL DEFAULT 'INV',
  shipping_flat_rate numeric(10,2) NOT NULL DEFAULT 0,
  free_shipping_above numeric(12,2),
  cod_enabled boolean NOT NULL DEFAULT true,
  cod_fee numeric(10,2) NOT NULL DEFAULT 0,
  cod_max_order numeric(12,2),
  regions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_gstin_format CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  CONSTRAINT commerce_rate_check CHECK (default_gst_rate IN (0, 0.25, 3, 5, 12, 18, 28)),
  CONSTRAINT commerce_prefix_check CHECK (invoice_prefix ~ '^[A-Z0-9-]{1,10}$'),
  CONSTRAINT commerce_money_check CHECK (shipping_flat_rate >= 0 AND cod_fee >= 0 AND coalesce(free_shipping_above, 0) >= 0 AND coalesce(cod_max_order, 0) >= 0),
  CONSTRAINT commerce_regions_array CHECK (jsonb_typeof(regions) = 'array' AND jsonb_array_length(regions) <= 40),
  CONSTRAINT commerce_text_len CHECK (char_length(legal_name) <= 120 AND char_length(business_address) <= 400 AND char_length(business_state) <= 60)
);
GRANT SELECT, INSERT, UPDATE ON public.store_commerce_settings TO authenticated;
GRANT ALL ON public.store_commerce_settings TO service_role;
ALTER TABLE public.store_commerce_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own commerce read" ON public.store_commerce_settings FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own commerce insert" ON public.store_commerce_settings FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own commerce update" ON public.store_commerce_settings FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

ALTER TABLE public.orders
  ADD COLUMN shipping_fee numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN cod_fee numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN taxable_total numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_total numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN cgst numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN sgst numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN igst numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN gst_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN prices_include_gst boolean NOT NULL DEFAULT true,
  ADD COLUMN place_of_supply text,
  ADD COLUMN invoice_number text,
  ADD COLUMN invoiced_at timestamptz,
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN shipped_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN courier text,
  ADD COLUMN tracking_number text,
  ADD COLUMN tracking_url text;
CREATE UNIQUE INDEX orders_owner_invoice_key ON public.orders (owner_id, invoice_number) WHERE invoice_number IS NOT NULL;

ALTER TABLE public.order_items
  ADD COLUMN hsn_code text,
  ADD COLUMN gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN taxable_value numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.customers ADD COLUMN cod_blocked boolean NOT NULL DEFAULT false;
GRANT UPDATE (cod_blocked) ON public.customers TO authenticated;

CREATE TABLE public.invoice_counters (
  owner_id uuid NOT NULL, fy text NOT NULL, last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, fy)
);
GRANT ALL ON public.invoice_counters TO service_role;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.financial_year(_at timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN extract(month FROM (_at AT TIME ZONE 'Asia/Kolkata')) >= 4
    THEN extract(year FROM (_at AT TIME ZONE 'Asia/Kolkata'))::int::text || '-' || lpad(((extract(year FROM (_at AT TIME ZONE 'Asia/Kolkata'))::int + 1) % 100)::text, 2, '0')
    ELSE (extract(year FROM (_at AT TIME ZONE 'Asia/Kolkata'))::int - 1)::text || '-' || lpad((extract(year FROM (_at AT TIME ZONE 'Asia/Kolkata'))::int % 100)::text, 2, '0') END
$$;

CREATE OR REPLACE FUNCTION public.assign_invoice_number(_order_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o public.orders; v_fy text; v_n int; v_prefix text; v_no text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Order not found.'; END IF;
  IF o.invoice_number IS NOT NULL THEN RETURN o.invoice_number; END IF;
  v_fy := public.financial_year(now());
  SELECT invoice_prefix INTO v_prefix FROM public.store_commerce_settings WHERE owner_id = o.owner_id;
  v_prefix := coalesce(v_prefix, 'INV');
  INSERT INTO public.invoice_counters (owner_id, fy, last_number) VALUES (o.owner_id, v_fy, 1)
  ON CONFLICT (owner_id, fy) DO UPDATE SET last_number = public.invoice_counters.last_number + 1
  RETURNING last_number INTO v_n;
  v_no := v_prefix || '/' || v_fy || '/' || lpad(v_n::text, 5, '0');
  UPDATE public.orders SET invoice_number = v_no, invoiced_at = now() WHERE id = o.id;
  RETURN v_no;
END $$;

-- ======================= Module 13: notifications =======================
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_owner_idx ON public.notifications (owner_id, created_at DESC);
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications read" ON public.notifications FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own notifications delete" ON public.notifications FOR DELETE TO authenticated USING (owner_id = auth.uid());
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

CREATE TABLE public.notification_preferences (
  owner_id uuid PRIMARY KEY,
  new_order_in_app boolean NOT NULL DEFAULT true,
  low_stock_in_app boolean NOT NULL DEFAULT true,
  low_stock_email boolean NOT NULL DEFAULT false,
  low_stock_threshold integer NOT NULL DEFAULT 5,
  daily_summary_email boolean NOT NULL DEFAULT false,
  customer_email_updates boolean NOT NULL DEFAULT true,
  customer_whatsapp_updates boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prefs_threshold_check CHECK (low_stock_threshold BETWEEN 0 AND 10000)
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own prefs read" ON public.notification_preferences FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own prefs insert" ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own prefs update" ON public.notification_preferences FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  channel text NOT NULL,
  kind text NOT NULL,
  recipient text,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_channel_check CHECK (channel IN ('email','whatsapp')),
  CONSTRAINT outbox_status_check CHECK (status IN ('pending','sending','sent','failed','skipped'))
);
CREATE INDEX outbox_owner_idx ON public.notification_outbox (owner_id, created_at DESC);
CREATE INDEX outbox_due_idx ON public.notification_outbox (next_attempt_at) WHERE status = 'pending';
GRANT SELECT ON public.notification_outbox TO authenticated;
GRANT ALL ON public.notification_outbox TO service_role;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own outbox read" ON public.notification_outbox FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.prefs_for(_owner uuid) RETURNS public.notification_preferences LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.notification_preferences;
BEGIN
  SELECT * INTO p FROM public.notification_preferences WHERE owner_id = _owner;
  IF NOT FOUND THEN p.owner_id := _owner; p.new_order_in_app := true; p.low_stock_in_app := true; p.low_stock_email := false;
    p.low_stock_threshold := 5; p.daily_summary_email := false; p.customer_email_updates := true; p.customer_whatsapp_updates := false; END IF;
  RETURN p;
END $$;

CREATE OR REPLACE FUNCTION public.notify_new_order(_order_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o public.orders; p public.notification_preferences; v_alerts boolean;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN; END IF;
  p := public.prefs_for(o.owner_id);
  IF p.new_order_in_app THEN
    INSERT INTO public.notifications (owner_id, kind, title, body, link)
    VALUES (o.owner_id, 'new_order', 'New order #' || o.order_number, o.customer_name || ' · ₹' || to_char(o.total, 'FM99,99,99,990.00'), '/orders');
  END IF;
  SELECT order_alerts INTO v_alerts FROM public.profiles WHERE id = o.owner_id;
  IF coalesce(v_alerts, true) THEN
    INSERT INTO public.notification_outbox (owner_id, channel, kind, subject, payload, dedupe_key)
    VALUES (o.owner_id, 'email', 'new_order', 'New order #' || o.order_number, jsonb_build_object('order_id', o.id), 'new_order:' || o.id)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notify_order_status(_order_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o public.orders; p public.notification_preferences; v_store text; v_msg text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND OR o.status NOT IN ('confirmed','shipped','delivered','cancelled') THEN RETURN; END IF;
  p := public.prefs_for(o.owner_id);
  SELECT store_name INTO v_store FROM public.profiles WHERE id = o.owner_id;
  v_msg := CASE o.status
    WHEN 'confirmed' THEN 'Your order #' || o.order_number || ' from ' || v_store || ' is confirmed.'
    WHEN 'shipped' THEN 'Your order #' || o.order_number || ' from ' || v_store || ' has shipped.' ||
      CASE WHEN o.tracking_number IS NOT NULL THEN ' ' || coalesce(o.courier, 'Courier') || ' tracking: ' || o.tracking_number || coalesce(' ' || o.tracking_url, '') ELSE '' END
    WHEN 'delivered' THEN 'Your order #' || o.order_number || ' from ' || v_store || ' was delivered. Thank you!'
    ELSE 'Your order #' || o.order_number || ' from ' || v_store || ' was cancelled.' END;
  IF p.customer_email_updates AND o.customer_email IS NOT NULL THEN
    INSERT INTO public.notification_outbox (owner_id, channel, kind, recipient, subject, body, payload, dedupe_key)
    VALUES (o.owner_id, 'email', 'order_status', o.customer_email, 'Order #' || o.order_number || ' update from ' || v_store, v_msg,
      jsonb_build_object('order_id', o.id, 'status', o.status), 'status_email:' || o.id || ':' || o.status)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  IF p.customer_whatsapp_updates AND o.customer_phone IS NOT NULL THEN
    INSERT INTO public.notification_outbox (owner_id, channel, kind, recipient, subject, body, payload, dedupe_key)
    VALUES (o.owner_id, 'whatsapp', 'order_status', '91' || o.customer_phone, 'Order #' || o.order_number, v_msg,
      jsonb_build_object('order_id', o.id, 'status', o.status, 'order_number', o.order_number, 'store', v_store), 'status_wa:' || o.id || ':' || o.status)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.low_stock_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.notification_preferences;
BEGIN
  p := public.prefs_for(new.owner_id);
  IF new.stock <= p.low_stock_threshold AND old.stock > p.low_stock_threshold THEN
    IF p.low_stock_in_app THEN
      INSERT INTO public.notifications (owner_id, kind, title, body, link)
      VALUES (new.owner_id, 'low_stock', CASE WHEN new.stock <= 0 THEN 'Out of stock: ' ELSE 'Low stock: ' END || new.title, new.stock || ' left', '/products');
    END IF;
    IF p.low_stock_email THEN
      INSERT INTO public.notification_outbox (owner_id, channel, kind, subject, body, payload, dedupe_key)
      VALUES (new.owner_id, 'email', 'low_stock', 'Low stock: ' || new.title, new.title || ' has ' || new.stock || ' left in stock.',
        jsonb_build_object('product_id', new.id), 'low_stock:' || new.id || ':' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD'))
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER products_low_stock AFTER UPDATE OF stock ON public.products FOR EACH ROW WHEN (new.stock < old.stock) EXECUTE FUNCTION public.low_stock_alert();

CREATE OR REPLACE FUNCTION public.claim_outbox(_limit integer DEFAULT 20) RETURNS SETOF public.notification_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN QUERY UPDATE public.notification_outbox o SET status = 'sending', attempts = o.attempts + 1, next_attempt_at = now()
  WHERE o.id IN (SELECT id FROM public.notification_outbox WHERE status = 'pending' AND next_attempt_at <= now()
                 ORDER BY next_attempt_at LIMIT least(greatest(_limit, 1), 50) FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION public.finish_outbox(_id uuid, _outcome text, _error text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _outcome = 'sent' THEN
    UPDATE public.notification_outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = _id;
  ELSIF _outcome = 'skipped' THEN
    UPDATE public.notification_outbox SET status = 'skipped', last_error = left(_error, 500) WHERE id = _id;
  ELSE
    UPDATE public.notification_outbox SET
      status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
      next_attempt_at = now() + make_interval(mins => (power(2, least(attempts, 6)))::int * 5),
      last_error = left(_error, 500)
    WHERE id = _id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_outbox() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_day date := ((now() AT TIME ZONE 'Asia/Kolkata') - interval '1 day')::date; v_from timestamptz; v_to timestamptz; v_cnt int;
BEGIN
  UPDATE public.notification_outbox SET status = 'pending', next_attempt_at = now() WHERE status = 'sending' AND next_attempt_at < now() - interval '15 minutes';
  IF extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata') >= 9 THEN
    v_from := (v_day::timestamp AT TIME ZONE 'Asia/Kolkata'); v_to := v_from + interval '1 day';
    FOR r IN SELECT np.owner_id,
        (SELECT count(*) FROM public.orders o WHERE o.owner_id = np.owner_id AND o.created_at >= v_from AND o.created_at < v_to) AS orders,
        (SELECT coalesce(sum(total), 0) FROM public.orders o WHERE o.owner_id = np.owner_id AND o.created_at >= v_from AND o.created_at < v_to AND o.status <> 'cancelled') AS revenue,
        (SELECT count(*) FROM public.orders o WHERE o.owner_id = np.owner_id AND o.status = 'pending') AS waiting,
        (SELECT count(*) FROM public.products p WHERE p.owner_id = np.owner_id AND p.stock <= np.low_stock_threshold) AS low
      FROM public.notification_preferences np WHERE np.daily_summary_email LOOP
      INSERT INTO public.notification_outbox (owner_id, channel, kind, subject, body, payload, dedupe_key)
      VALUES (r.owner_id, 'email', 'daily_summary', 'Your store yesterday (' || to_char(v_day, 'DD Mon YYYY') || ')',
        'Orders: ' || r.orders || E'\nRevenue: ₹' || to_char(r.revenue, 'FM99,99,99,990.00') || E'\nOrders waiting for confirmation: ' || r.waiting || E'\nProducts low on stock: ' || r.low,
        jsonb_build_object('day', v_day), 'daily:' || r.owner_id || ':' || v_day)
      ON CONFLICT (dedupe_key) DO NOTHING;
    END LOOP;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.notification_outbox WHERE status = 'pending' AND next_attempt_at <= now();
  RETURN v_cnt;
END $$;

-- ======================= Module 15: rate limits & audit log =======================
CREATE TABLE public.rate_limits (
  bucket text NOT NULL, subject text NOT NULL, window_start timestamptz NOT NULL, hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, subject, window_start)
);
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.hit_rate_limit(_bucket text, _subject text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_limit int; v_window int; v_start timestamptz; v_hits int;
BEGIN
  SELECT l, w INTO v_limit, v_window FROM (VALUES ('checkout', 10, 600), ('track', 300, 600), ('storefront', 600, 600)) AS t(b, l, w) WHERE b = _bucket;
  IF v_limit IS NULL THEN RAISE EXCEPTION 'Unknown rate limit bucket'; END IF;
  v_start := to_timestamp(floor(extract(epoch FROM now()) / v_window) * v_window);
  INSERT INTO public.rate_limits (bucket, subject, window_start, hits) VALUES (_bucket, left(_subject, 128), v_start, 1)
  ON CONFLICT (bucket, subject, window_start) DO UPDATE SET hits = public.rate_limits.hits + 1
  RETURNING hits INTO v_hits;
  IF random() < 0.02 THEN DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day'; END IF;
  RETURN v_hits <= v_limit;
END $$;

CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id uuid NOT NULL,
  actor uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_owner_idx ON public.audit_log (owner_id, created_at DESC);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audit read" ON public.audit_log FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_owner uuid; v_id text; v_details jsonb := '{}'::jsonb; v_action text;
BEGIN
  IF tg_table_name = 'profiles' THEN v_owner := new.id; v_id := v_owner::text;
  ELSIF tg_op = 'DELETE' THEN v_owner := old.owner_id; v_id := old.id::text;
  ELSIF tg_table_name IN ('store_themes','store_commerce_settings','notification_preferences') THEN v_owner := new.owner_id; v_id := v_owner::text;
  ELSE v_owner := new.owner_id; v_id := new.id::text;
  END IF;
  v_action := tg_table_name || '.' || lower(tg_op);
  IF tg_table_name = 'products' THEN
    IF tg_op = 'DELETE' THEN v_details := jsonb_build_object('title', old.title);
    ELSE v_details := jsonb_build_object('title', new.title); END IF;
    IF tg_op = 'UPDATE' THEN
      IF auth.uid() IS NULL THEN RETURN NULL; END IF;
      IF new.price IS DISTINCT FROM old.price THEN v_details := v_details || jsonb_build_object('price', jsonb_build_array(old.price, new.price)); END IF;
      IF new.stock IS DISTINCT FROM old.stock THEN v_details := v_details || jsonb_build_object('stock', jsonb_build_array(old.stock, new.stock)); END IF;
    END IF;
  ELSIF tg_table_name = 'store_themes' THEN
    IF new.published_at IS NULL THEN RETURN NULL; END IF;
    IF tg_op = 'UPDATE' AND new.published_at IS NOT DISTINCT FROM old.published_at THEN RETURN NULL; END IF;
    v_action := 'theme.published';
  ELSIF tg_table_name = 'customers' THEN
    IF new.erased_at IS NOT NULL AND old.erased_at IS NULL THEN v_action := 'customer.erased';
    ELSIF new.cod_blocked IS DISTINCT FROM old.cod_blocked THEN v_action := CASE WHEN new.cod_blocked THEN 'customer.cod_blocked' ELSE 'customer.cod_unblocked' END;
    ELSE RETURN NULL; END IF;
  ELSIF tg_table_name = 'orders' THEN
    IF new.status IS NOT DISTINCT FROM old.status AND new.tracking_number IS NOT DISTINCT FROM old.tracking_number THEN RETURN NULL; END IF;
    v_action := CASE WHEN new.status IS DISTINCT FROM old.status THEN 'order.' || new.status ELSE 'order.tracking' END;
    v_details := jsonb_build_object('order_number', new.order_number, 'from', old.status, 'to', new.status);
  END IF;
  INSERT INTO public.audit_log (owner_id, actor, action, entity, entity_id, details) VALUES (v_owner, auth.uid(), v_action, tg_table_name, v_id, v_details);
  RETURN NULL;
END $$;
CREATE TRIGGER audit_products AFTER INSERT OR UPDATE OR DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER audit_profiles AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER audit_commerce AFTER INSERT OR UPDATE ON public.store_commerce_settings FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER audit_prefs AFTER INSERT OR UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER audit_themes AFTER INSERT OR UPDATE ON public.store_themes FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER audit_customers AFTER UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER audit_orders AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_change();

-- ======================= Module 14: analytics =======================
CREATE TABLE public.analytics_salts (day date PRIMARY KEY, salt text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'));
GRANT ALL ON public.analytics_salts TO service_role;
ALTER TABLE public.analytics_salts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.store_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id uuid NOT NULL,
  day date NOT NULL,
  visitor text NOT NULL,
  event text NOT NULL,
  source text NOT NULL DEFAULT 'direct',
  path text NOT NULL DEFAULT '/',
  product_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_events_event_check CHECK (event IN ('view','product_view','add_to_cart','checkout_start','order'))
);
CREATE UNIQUE INDEX store_events_dedupe ON public.store_events (owner_id, day, visitor, event, path);
CREATE INDEX store_events_owner_day ON public.store_events (owner_id, day);
GRANT SELECT ON public.store_events TO authenticated;
GRANT ALL ON public.store_events TO service_role;
ALTER TABLE public.store_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events read" ON public.store_events FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.track_store_event(_slug text, _fingerprint text, _event text, _source text DEFAULT 'direct', _path text DEFAULT '/', _product uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_owner uuid; v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_salt text; v_visitor text;
BEGIN
  IF _event NOT IN ('view','product_view','add_to_cart','checkout_start','order') THEN RETURN false; END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE store_slug = lower(btrim(coalesce(_slug, '')));
  IF v_owner IS NULL THEN RETURN false; END IF;
  INSERT INTO public.analytics_salts (day) VALUES (v_day) ON CONFLICT (day) DO NOTHING;
  SELECT salt INTO v_salt FROM public.analytics_salts WHERE day = v_day;
  DELETE FROM public.analytics_salts WHERE day < v_day - 1;
  v_visitor := left(encode(extensions.digest(v_salt || '|' || v_owner::text || '|' || coalesce(_fingerprint, ''), 'sha256'), 'hex'), 32);
  INSERT INTO public.store_events (owner_id, day, visitor, event, source, path, product_id)
  VALUES (v_owner, v_day, v_visitor, _event, left(lower(coalesce(nullif(btrim(_source), ''), 'direct')), 60), left(coalesce(nullif(_path, ''), '/'), 200),
    CASE WHEN _product IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE id = _product AND owner_id = v_owner) THEN _product END)
  ON CONFLICT DO NOTHING;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_report(_from date, _to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); v_from timestamptz; v_to timestamptz; result jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 366 THEN RAISE EXCEPTION 'INVALID: Choose a date range of up to one year.'; END IF;
  v_from := (_from::timestamp AT TIME ZONE 'Asia/Kolkata'); v_to := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  WITH days AS (SELECT d::date AS day FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') d),
  ord AS (SELECT * FROM public.orders WHERE owner_id = uid AND created_at >= v_from AND created_at < v_to),
  ev AS (SELECT * FROM public.store_events WHERE owner_id = uid AND day BETWEEN _from AND _to)
  SELECT jsonb_build_object(
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'visitors', (SELECT count(DISTINCT visitor) FROM ev WHERE ev.day = d.day),
        'orders', (SELECT count(*) FROM ord WHERE (ord.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day AND ord.status <> 'cancelled'),
        'revenue', (SELECT coalesce(sum(total), 0) FROM ord WHERE (ord.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day AND ord.status <> 'cancelled')
      ) ORDER BY d.day), '[]'::jsonb) FROM days d),
    'totals', jsonb_build_object(
      'visitors', (SELECT count(DISTINCT (day, visitor)) FROM ev),
      'orders', (SELECT count(*) FROM ord WHERE status <> 'cancelled'),
      'cancelled', (SELECT count(*) FROM ord WHERE status = 'cancelled'),
      'revenue', (SELECT coalesce(sum(total), 0) FROM ord WHERE status <> 'cancelled'),
      'tax', (SELECT coalesce(sum(tax_total), 0) FROM ord WHERE status <> 'cancelled'),
      'shipping', (SELECT coalesce(sum(shipping_fee), 0) FROM ord WHERE status <> 'cancelled'),
      'delivered_revenue', (SELECT coalesce(sum(total), 0) FROM ord WHERE status = 'delivered'),
      'customers', (SELECT count(DISTINCT customer_id) FROM ord WHERE status <> 'cancelled'),
      'repeat_customers', (SELECT count(*) FROM (SELECT customer_id FROM ord WHERE status <> 'cancelled' AND customer_id IS NOT NULL GROUP BY customer_id HAVING count(*) > 1) x)
    ),
    'funnel', jsonb_build_object(
      'view', (SELECT count(DISTINCT (day, visitor)) FROM ev WHERE event IN ('view','product_view')),
      'add_to_cart', (SELECT count(DISTINCT (day, visitor)) FROM ev WHERE event = 'add_to_cart'),
      'checkout_start', (SELECT count(DISTINCT (day, visitor)) FROM ev WHERE event = 'checkout_start'),
      'order', (SELECT count(DISTINCT (day, visitor)) FROM ev WHERE event = 'order')
    ),
    'sources', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', source, 'visitors', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (SELECT source, count(DISTINCT (day, visitor)) AS n FROM ev WHERE event IN ('view','product_view') GROUP BY source ORDER BY n DESC LIMIT 12) s),
    'status', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) AS n FROM ord GROUP BY status) s),
    'top_products', (SELECT coalesce(jsonb_agg(jsonb_build_object('title', title, 'units', units, 'revenue', revenue) ORDER BY revenue DESC), '[]'::jsonb)
      FROM (SELECT i.title, sum(i.quantity) AS units, sum(i.line_total) AS revenue FROM public.order_items i JOIN ord ON ord.id = i.order_id
            WHERE ord.status <> 'cancelled' GROUP BY i.title ORDER BY sum(i.line_total) DESC LIMIT 10) t)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.gst_report(_from date, _to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); v_from timestamptz; v_to timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 366 THEN RAISE EXCEPTION 'INVALID: Choose a date range of up to one year.'; END IF;
  v_from := (_from::timestamp AT TIME ZONE 'Asia/Kolkata'); v_to := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  RETURN jsonb_build_object(
    'invoices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'invoice_number', o.invoice_number, 'invoiced_at', o.invoiced_at, 'order_number', o.order_number, 'customer', o.customer_name,
        'place_of_supply', o.place_of_supply, 'taxable', o.taxable_total, 'cgst', o.cgst, 'sgst', o.sgst, 'igst', o.igst,
        'shipping', o.shipping_fee, 'cod_fee', o.cod_fee, 'total', o.total, 'status', o.status) ORDER BY o.invoiced_at), '[]'::jsonb)
      FROM public.orders o WHERE o.owner_id = uid AND o.invoice_number IS NOT NULL AND o.invoiced_at >= v_from AND o.invoiced_at < v_to),
    'hsn', (SELECT coalesce(jsonb_agg(jsonb_build_object('hsn', hsn, 'rate', rate, 'quantity', qty, 'taxable', taxable, 'tax', tax) ORDER BY hsn, rate), '[]'::jsonb)
      FROM (SELECT coalesce(i.hsn_code, '—') AS hsn, i.gst_rate AS rate, sum(i.quantity) AS qty, sum(i.taxable_value) AS taxable, sum(i.tax_amount) AS tax
            FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
            WHERE o.owner_id = uid AND o.invoice_number IS NOT NULL AND o.status <> 'cancelled' AND o.invoiced_at >= v_from AND o.invoiced_at < v_to
            GROUP BY 1, 2) h)
  );
END $$;

-- ======================= Storefront, checkout, order status =======================
CREATE OR REPLACE FUNCTION public.storefront(_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'store_name', p.store_name,
    'slug', p.store_slug,
    'theme', (SELECT t.published FROM public.store_themes t WHERE t.owner_id = p.id),
    'commerce', coalesce((SELECT jsonb_build_object(
        'gst_enabled', c.gst_enabled, 'prices_include_gst', c.prices_include_gst, 'default_gst_rate', c.default_gst_rate,
        'business_state', c.business_state, 'shipping_flat_rate', c.shipping_flat_rate, 'free_shipping_above', c.free_shipping_above,
        'cod_enabled', c.cod_enabled, 'cod_fee', c.cod_fee, 'cod_max_order', c.cod_max_order, 'regions', c.regions)
      FROM public.store_commerce_settings c WHERE c.owner_id = p.id), '{}'::jsonb),
    'products', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'description', x.description, 'price', x.price,
        'compare_at_price', x.compare_at_price, 'category', x.category, 'image_path', x.image_path, 'gst_rate', x.gst_rate,
        'available', least(greatest(x.stock, 0), 99), 'created_at', x.created_at) ORDER BY x.title)
      FROM public.products x WHERE x.owner_id = p.id), '[]'::jsonb))
  FROM public.profiles p WHERE p.store_slug = lower(btrim(_slug))
$$;

CREATE OR REPLACE FUNCTION public.place_order(_slug text, _checkout_key uuid, _customer jsonb, _items jsonb, _notes text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_owner uuid; v_existing public.orders; v_name text; v_phone text; v_email text; v_addr jsonb;
  v_line1 text; v_line2 text; v_city text; v_state text; v_pin text; v_notes text;
  v_item jsonb; v_product public.products; v_qty int; v_units int := 0;
  v_order_id uuid; v_number int; v_customer uuid; v_blocked boolean := false;
  c public.store_commerce_settings; v_region jsonb; v_gst boolean; v_incl boolean; v_rate numeric; v_line numeric(12,2);
  v_taxable numeric(12,2); v_tax numeric(12,2); v_item_total numeric(12,2);
  v_goods numeric(12,2) := 0; v_taxable_sum numeric(12,2) := 0; v_tax_sum numeric(12,2) := 0;
  v_ship numeric(10,2) := 0; v_cod numeric(10,2) := 0; v_cgst numeric(12,2) := 0; v_sgst numeric(12,2) := 0; v_igst numeric(12,2) := 0; v_total numeric(12,2);
BEGIN
  SELECT id INTO v_owner FROM public.profiles WHERE store_slug = lower(btrim(coalesce(_slug, '')));
  IF v_owner IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND: This store does not exist.'; END IF;
  IF _checkout_key IS NULL THEN RAISE EXCEPTION 'INVALID: Missing checkout reference.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_owner::text));

  SELECT * INTO v_existing FROM public.orders WHERE owner_id = v_owner AND checkout_key = _checkout_key;
  IF FOUND THEN
    RETURN jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number, 'total', v_existing.total, 'owner_id', v_owner, 'duplicate', true);
  END IF;

  v_name := btrim(coalesce(_customer->>'name', ''));
  v_phone := regexp_replace(coalesce(_customer->>'phone', ''), '\D', '', 'g');
  IF char_length(v_phone) = 12 AND left(v_phone, 2) = '91' THEN v_phone := substr(v_phone, 3); END IF;
  v_email := nullif(lower(btrim(coalesce(_customer->>'email', ''))), '');
  v_line1 := btrim(coalesce(_customer->>'line1', ''));
  v_line2 := btrim(coalesce(_customer->>'line2', ''));
  v_city := btrim(coalesce(_customer->>'city', ''));
  v_state := btrim(coalesce(_customer->>'state', ''));
  v_pin := btrim(coalesce(_customer->>'pincode', ''));
  v_notes := btrim(coalesce(_notes, ''));

  IF char_length(v_name) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'INVALID: Enter your full name.'; END IF;
  IF v_phone !~ '^[6-9][0-9]{9}$' THEN RAISE EXCEPTION 'INVALID: Enter a valid 10-digit mobile number.'; END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN RAISE EXCEPTION 'INVALID: Enter a valid email address.'; END IF;
  IF char_length(v_line1) NOT BETWEEN 5 AND 200 OR char_length(v_line2) > 200 THEN RAISE EXCEPTION 'INVALID: Enter your delivery address.'; END IF;
  IF char_length(v_city) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'INVALID: Enter your city.'; END IF;
  IF char_length(v_state) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'INVALID: Enter your state.'; END IF;
  IF v_pin !~ '^[1-9][0-9]{5}$' THEN RAISE EXCEPTION 'INVALID: Enter a valid 6-digit PIN code.'; END IF;
  IF char_length(v_notes) > 500 THEN RAISE EXCEPTION 'INVALID: Order notes can be at most 500 characters.'; END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID: Your cart is empty.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_items) x WHERE coalesce(x->>'product_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR coalesce(x->>'quantity', '') !~ '^[0-9]{1,2}$' OR (x->>'quantity')::int < 1) THEN
    RAISE EXCEPTION 'INVALID: Your cart contains an invalid item.';
  END IF;
  IF (SELECT count(DISTINCT x->>'product_id') FROM jsonb_array_elements(_items) x) <> jsonb_array_length(_items) THEN RAISE EXCEPTION 'INVALID: Your cart contains a duplicate item.'; END IF;

  SELECT * INTO c FROM public.store_commerce_settings WHERE owner_id = v_owner;
  IF NOT FOUND THEN c.owner_id := v_owner; c.gst_enabled := false; c.prices_include_gst := true; c.default_gst_rate := 18; c.business_state := '';
    c.shipping_flat_rate := 0; c.free_shipping_above := NULL; c.cod_enabled := true; c.cod_fee := 0; c.cod_max_order := NULL; c.regions := '[]'::jsonb; END IF;
  SELECT r INTO v_region FROM jsonb_array_elements(c.regions) r WHERE lower(btrim(r->>'state')) = lower(v_state) LIMIT 1;
  IF v_region IS NOT NULL AND (v_region->>'deliver') = 'false' THEN RAISE EXCEPTION 'UNSERVICEABLE: Sorry, this shop does not deliver to % yet.', v_state; END IF;
  SELECT cod_blocked INTO v_blocked FROM public.customers WHERE owner_id = v_owner AND phone = v_phone;
  v_gst := c.gst_enabled; v_incl := c.prices_include_gst;

  v_addr := jsonb_build_object('line1', v_line1, 'line2', v_line2, 'city', v_city, 'state', v_state, 'pincode', v_pin);

  INSERT INTO public.customers (owner_id, name, email, phone, address)
  VALUES (v_owner, v_name, v_email, v_phone, v_addr)
  ON CONFLICT (owner_id, phone) DO UPDATE SET name = excluded.name, email = coalesce(excluded.email, public.customers.email), address = excluded.address, erased_at = NULL, updated_at = now()
  RETURNING id INTO v_customer;

  SELECT coalesce(max(order_number), 0) + 1 INTO v_number FROM public.orders WHERE owner_id = v_owner;

  INSERT INTO public.orders (owner_id, customer_name, customer_email, customer_phone, shipping_address, notes, order_number, customer_id, checkout_key, source, quantity, subtotal, total, place_of_supply, gst_applied, prices_include_gst)
  VALUES (v_owner, v_name, v_email, v_phone, v_addr, v_notes, v_number, v_customer, _checkout_key, 'storefront', 0, 0, 0, v_state, v_gst, v_incl)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND owner_id = v_owner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'UNAVAILABLE: A product in your cart is no longer available.'; END IF;
    IF v_product.stock < v_qty THEN
      RAISE EXCEPTION 'OUT_OF_STOCK: Only % left of "%".', greatest(v_product.stock, 0), v_product.title;
    END IF;
    UPDATE public.products SET stock = stock - v_qty WHERE id = v_product.id;
    v_line := v_product.price * v_qty;
    v_rate := CASE WHEN v_gst THEN coalesce(v_product.gst_rate, c.default_gst_rate) ELSE 0 END;
    IF v_gst AND v_incl THEN
      v_taxable := round(v_line / (1 + v_rate / 100), 2); v_tax := v_line - v_taxable; v_item_total := v_line;
    ELSIF v_gst THEN
      v_taxable := v_line; v_tax := round(v_line * v_rate / 100, 2); v_item_total := v_line + v_tax;
    ELSE
      v_taxable := v_line; v_tax := 0; v_item_total := v_line;
    END IF;
    INSERT INTO public.order_items (order_id, owner_id, product_id, title, unit_price, quantity, line_total, hsn_code, gst_rate, taxable_value, tax_amount)
    VALUES (v_order_id, v_owner, v_product.id, v_product.title, v_product.price, v_qty, v_item_total, v_product.hsn_code, v_rate, v_taxable, v_tax);
    v_goods := v_goods + v_item_total; v_taxable_sum := v_taxable_sum + v_taxable; v_tax_sum := v_tax_sum + v_tax;
    v_units := v_units + v_qty;
  END LOOP;

  v_ship := coalesce(nullif(v_region->>'rate', '')::numeric, c.shipping_flat_rate);
  IF c.free_shipping_above IS NOT NULL AND v_goods >= c.free_shipping_above THEN v_ship := 0; END IF;
  IF NOT c.cod_enabled OR coalesce(v_region->>'cod', 'true') = 'false' OR coalesce(v_blocked, false)
     OR (c.cod_max_order IS NOT NULL AND v_goods + v_ship > c.cod_max_order) THEN
    RAISE EXCEPTION 'COD_UNAVAILABLE: Cash on delivery is not available for this order. Please contact the shop.';
  END IF;
  v_cod := c.cod_fee;
  IF v_gst AND c.business_state <> '' AND lower(btrim(c.business_state)) = lower(v_state) THEN
    v_cgst := round(v_tax_sum / 2, 2); v_sgst := v_tax_sum - v_cgst;
  ELSIF v_gst THEN
    v_igst := v_tax_sum;
  END IF;
  v_total := v_goods + v_ship + v_cod;

  UPDATE public.orders SET subtotal = v_goods, total = v_total, quantity = v_units, shipping_fee = v_ship, cod_fee = v_cod,
    taxable_total = v_taxable_sum, tax_total = v_tax_sum, cgst = v_cgst, sgst = v_sgst, igst = v_igst WHERE id = v_order_id;
  UPDATE public.customers SET order_count = order_count + 1, total_spent = total_spent + v_total,
    first_order_at = coalesce(first_order_at, now()), last_order_at = now() WHERE id = v_customer;
  PERFORM public.notify_new_order(v_order_id);

  RETURN jsonb_build_object('order_id', v_order_id, 'order_number', v_number, 'total', v_total, 'owner_id', v_owner, 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION public.set_order_status(_order_id uuid, _status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o public.orders; allowed text[];
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Order not found.'; END IF;
  allowed := CASE o.status
    WHEN 'pending' THEN ARRAY['confirmed','cancelled']
    WHEN 'confirmed' THEN ARRAY['packed','cancelled']
    WHEN 'packed' THEN ARRAY['shipped','cancelled']
    WHEN 'shipped' THEN ARRAY['delivered']
    ELSE ARRAY[]::text[] END;
  IF NOT (_status = ANY(allowed)) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: A % order cannot be marked %.', o.status, _status;
  END IF;
  UPDATE public.orders SET status = _status, updated_at = now(),
    cancelled_at = CASE WHEN _status = 'cancelled' THEN now() ELSE cancelled_at END,
    confirmed_at = CASE WHEN _status = 'confirmed' THEN now() ELSE confirmed_at END,
    shipped_at = CASE WHEN _status = 'shipped' THEN now() ELSE shipped_at END,
    delivered_at = CASE WHEN _status = 'delivered' THEN now() ELSE delivered_at END,
    payment_status = CASE WHEN _status = 'delivered' AND payment_method = 'cod' THEN 'paid' ELSE payment_status END
  WHERE id = o.id;
  IF _status = 'confirmed' THEN PERFORM public.assign_invoice_number(o.id); END IF;
  IF _status = 'cancelled' AND NOT o.stock_restored THEN
    UPDATE public.products p SET stock = p.stock + i.quantity FROM public.order_items i
      WHERE i.order_id = o.id AND i.product_id = p.id AND p.owner_id = o.owner_id;
    UPDATE public.orders SET stock_restored = true WHERE id = o.id;
    UPDATE public.customers SET order_count = greatest(order_count - 1, 0), total_spent = greatest(total_spent - o.total, 0), updated_at = now()
      WHERE id = o.customer_id AND owner_id = o.owner_id;
  END IF;
  PERFORM public.notify_order_status(o.id);
END $$;

CREATE OR REPLACE FUNCTION public.update_order_shipping(_order_id uuid, _courier text, _tracking_number text, _tracking_url text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _tracking_url IS NOT NULL AND _tracking_url <> '' AND _tracking_url !~ '^https://[^[:space:]]{3,300}$' THEN RAISE EXCEPTION 'INVALID: Tracking link must start with https://'; END IF;
  IF char_length(coalesce(_courier, '')) > 60 OR char_length(coalesce(_tracking_number, '')) > 60 THEN RAISE EXCEPTION 'INVALID: Courier and tracking number must be at most 60 characters.'; END IF;
  UPDATE public.orders SET courier = nullif(btrim(_courier), ''), tracking_number = nullif(btrim(_tracking_number), ''),
    tracking_url = nullif(btrim(_tracking_url), ''), updated_at = now()
  WHERE id = _order_id AND owner_id = auth.uid() AND status <> 'cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Order not found.'; END IF;
END $$;

-- ======================= Function grants =======================
REVOKE ALL ON FUNCTION public.storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.place_order(text, uuid, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(text, uuid, jsonb, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.set_order_status(uuid, text), public.update_order_shipping(uuid, text, text, text),
  public.analytics_report(date, date), public.gst_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_status(uuid, text), public.update_order_shipping(uuid, text, text, text),
  public.analytics_report(date, date), public.gst_report(date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.assign_invoice_number(uuid), public.prefs_for(uuid), public.notify_new_order(uuid), public.notify_order_status(uuid),
  public.claim_outbox(integer), public.finish_outbox(uuid, text, text), public.prepare_outbox(), public.hit_rate_limit(text, text),
  public.track_store_event(text, text, text, text, text, uuid), public.low_stock_alert(), public.audit_change(), public.trim_theme_versions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox(integer), public.finish_outbox(uuid, text, text), public.prepare_outbox(), public.hit_rate_limit(text, text),
  public.track_store_event(text, text, text, text, text, uuid), public.assign_invoice_number(uuid) TO service_role;
