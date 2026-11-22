-- 1. Switch on the plan-limit triggers that existed only as functions
CREATE TRIGGER a_lock_merchant_limits BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.lock_merchant_limits();
CREATE TRIGGER b_enforce_product_limits BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_product_limits();
CREATE TRIGGER a_lock_merchant_limits BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.lock_merchant_limits();
CREATE TRIGGER b_enforce_order_limits BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_order_limits();

-- 2. Store profile: public slug + alert preference
ALTER TABLE public.profiles ADD COLUMN store_slug text, ADD COLUMN order_alerts boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.profiles_fill_slug() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF new.store_slug IS NULL OR btrim(new.store_slug) = '' THEN
    new.store_slug := 'store-' || substr(replace(new.id::text, '-', ''), 1, 8);
  END IF;
  new.store_slug := lower(btrim(new.store_slug));
  new.store_name := btrim(new.store_name);
  RETURN new;
END $$;
CREATE TRIGGER profiles_fill_slug BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_fill_slug();

INSERT INTO public.profiles (id, display_name)
SELECT u.id, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)) FROM auth.users u
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET store_slug = 'store-' || substr(replace(id::text, '-', ''), 1, 8) WHERE store_slug IS NULL;

CREATE UNIQUE INDEX profiles_store_slug_key ON public.profiles (store_slug);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_store_slug_format CHECK (store_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
ALTER TABLE public.profiles ADD CONSTRAINT profiles_store_name_len CHECK (char_length(store_name) BETWEEN 1 AND 80);

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Customers
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  address jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  order_count integer NOT NULL DEFAULT 0,
  total_spent numeric(12,2) NOT NULL DEFAULT 0,
  first_order_at timestamptz,
  last_order_at timestamptz,
  erased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_notes_len CHECK (char_length(notes) <= 2000),
  CONSTRAINT customers_tags_len CHECK (cardinality(tags) <= 20)
);
CREATE UNIQUE INDEX customers_owner_phone_key ON public.customers (owner_id, phone);
CREATE INDEX customers_owner_last_idx ON public.customers (owner_id, last_order_at DESC);
REVOKE ALL ON public.customers FROM anon, authenticated;
GRANT SELECT ON public.customers TO authenticated;
GRANT UPDATE (notes, tags, updated_at) ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own customers read" ON public.customers FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own customers update" ON public.customers FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- 4. Orders: checkout fields
ALTER TABLE public.orders
  ADD COLUMN order_number integer,
  ADD COLUMN customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN customer_phone text,
  ADD COLUMN shipping_address jsonb,
  ADD COLUMN notes text NOT NULL DEFAULT '',
  ADD COLUMN subtotal numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN payment_method text NOT NULL DEFAULT 'cod',
  ADD COLUMN payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN source text NOT NULL DEFAULT 'storefront',
  ADD COLUMN checkout_key uuid,
  ADD COLUMN alert_sent_at timestamptz,
  ADD COLUMN alert_error text,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN stock_restored boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX orders_owner_number_key ON public.orders (owner_id, order_number);
CREATE UNIQUE INDEX orders_owner_checkout_key ON public.orders (owner_id, checkout_key);
CREATE INDEX orders_owner_created_idx ON public.orders (owner_id, created_at DESC);
CREATE INDEX orders_customer_idx ON public.orders (customer_id);
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending','confirmed','packed','shipped','delivered','cancelled'));
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('cod'));
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IN ('pending','paid','refunded'));
-- Orders are written only through place_order / set_order_status
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM anon, authenticated;
REVOKE SELECT ON public.orders FROM anon;

-- 5. Order line items
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  title text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_items_order_idx ON public.order_items (order_id);
REVOKE ALL ON public.order_items FROM anon, authenticated;
GRANT SELECT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own order items read" ON public.order_items FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- 6. Public storefront catalog
CREATE OR REPLACE FUNCTION public.storefront(_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'store_name', p.store_name,
    'slug', p.store_slug,
    'products', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'description', x.description, 'price', x.price, 'category', x.category, 'available', least(greatest(x.stock, 0), 99)) ORDER BY x.title)
      FROM public.products x WHERE x.owner_id = p.id), '[]'::jsonb))
  FROM public.profiles p WHERE p.store_slug = lower(btrim(_slug))
$$;
REVOKE ALL ON FUNCTION public.storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront(text) TO anon, authenticated, service_role;

-- 7. Checkout
CREATE OR REPLACE FUNCTION public.place_order(_slug text, _checkout_key uuid, _customer jsonb, _items jsonb, _notes text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid; v_existing public.orders; v_name text; v_phone text; v_email text; v_addr jsonb;
  v_line1 text; v_line2 text; v_city text; v_state text; v_pin text; v_notes text;
  v_item jsonb; v_product public.products; v_qty int; v_subtotal numeric(12,2) := 0; v_units int := 0;
  v_order_id uuid; v_number int; v_customer uuid;
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

  v_addr := jsonb_build_object('line1', v_line1, 'line2', v_line2, 'city', v_city, 'state', v_state, 'pincode', v_pin);

  INSERT INTO public.customers (owner_id, name, email, phone, address)
  VALUES (v_owner, v_name, v_email, v_phone, v_addr)
  ON CONFLICT (owner_id, phone) DO UPDATE SET name = excluded.name, email = coalesce(excluded.email, public.customers.email), address = excluded.address, erased_at = NULL, updated_at = now()
  RETURNING id INTO v_customer;

  SELECT coalesce(max(order_number), 0) + 1 INTO v_number FROM public.orders WHERE owner_id = v_owner;

  INSERT INTO public.orders (owner_id, customer_name, customer_email, customer_phone, shipping_address, notes, order_number, customer_id, checkout_key, source, quantity, subtotal, total)
  VALUES (v_owner, v_name, v_email, v_phone, v_addr, v_notes, v_number, v_customer, _checkout_key, 'storefront', 0, 0, 0)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND owner_id = v_owner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'UNAVAILABLE: A product in your cart is no longer available.'; END IF;
    IF v_product.stock < v_qty THEN
      RAISE EXCEPTION 'OUT_OF_STOCK: Only % left of "%".', greatest(v_product.stock, 0), v_product.title;
    END IF;
    UPDATE public.products SET stock = stock - v_qty WHERE id = v_product.id;
    INSERT INTO public.order_items (order_id, owner_id, product_id, title, unit_price, quantity, line_total)
    VALUES (v_order_id, v_owner, v_product.id, v_product.title, v_product.price, v_qty, v_product.price * v_qty);
    v_subtotal := v_subtotal + v_product.price * v_qty;
    v_units := v_units + v_qty;
  END LOOP;

  UPDATE public.orders SET subtotal = v_subtotal, total = v_subtotal, quantity = v_units WHERE id = v_order_id;
  UPDATE public.customers SET order_count = order_count + 1, total_spent = total_spent + v_subtotal,
    first_order_at = coalesce(first_order_at, now()), last_order_at = now() WHERE id = v_customer;

  RETURN jsonb_build_object('order_id', v_order_id, 'order_number', v_number, 'total', v_subtotal, 'owner_id', v_owner, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.place_order(text, uuid, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(text, uuid, jsonb, jsonb, text) TO anon, authenticated, service_role;

-- 8. Order status changes by the owner
CREATE OR REPLACE FUNCTION public.set_order_status(_order_id uuid, _status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    payment_status = CASE WHEN _status = 'delivered' AND payment_method = 'cod' THEN 'paid' ELSE payment_status END
  WHERE id = o.id;
  IF _status = 'cancelled' AND NOT o.stock_restored THEN
    UPDATE public.products p SET stock = p.stock + i.quantity FROM public.order_items i
      WHERE i.order_id = o.id AND i.product_id = p.id AND p.owner_id = o.owner_id;
    UPDATE public.orders SET stock_restored = true WHERE id = o.id;
    UPDATE public.customers SET order_count = greatest(order_count - 1, 0), total_spent = greatest(total_spent - o.total, 0), updated_at = now()
      WHERE id = o.customer_id AND owner_id = o.owner_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_order_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_order_status(uuid, text) TO authenticated;

-- 9. Customer erasure (privacy)
CREATE OR REPLACE FUNCTION public.erase_customer(_customer_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.customers SET name = 'Erased customer', email = NULL, phone = NULL, address = NULL, notes = '', tags = '{}', erased_at = now(), updated_at = now()
  WHERE id = _customer_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Customer not found.'; END IF;
  UPDATE public.orders SET customer_name = 'Erased customer', customer_email = NULL, customer_phone = NULL, shipping_address = NULL, notes = '', updated_at = now()
  WHERE customer_id = _customer_id AND owner_id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.erase_customer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_customer(uuid) TO authenticated;

-- 10. Live order updates for the owner's dashboard (RLS limits rows to the owner)
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;