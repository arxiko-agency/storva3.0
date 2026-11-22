-- STORVA database schema (public), exported 2026-11-18
-- Enums

-- Tables
CREATE TABLE public.ai_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  kind text NOT NULL,
  input jsonb DEFAULT '{}'::jsonb NOT NULL,
  output jsonb,
  status text NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone
);
CREATE TABLE public.ai_service_state (
  id text DEFAULT 'gateway'::text NOT NULL,
  reason text NOT NULL,
  status_code integer NOT NULL,
  blocked boolean DEFAULT true NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.customers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  address jsonb,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  notes text DEFAULT ''::text NOT NULL,
  order_count integer DEFAULT 0 NOT NULL,
  total_spent numeric(12,2) DEFAULT 0 NOT NULL,
  first_order_at timestamp with time zone,
  last_order_at timestamp with time zone,
  erased_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.invoices (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  razorpay_payment_id text,
  razorpay_invoice_id text,
  plan_id text,
  amount integer NOT NULL,
  currency text DEFAULT 'INR'::text NOT NULL,
  status text NOT NULL,
  invoice_url text,
  failure_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.order_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  product_id uuid,
  title text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  quantity integer NOT NULL,
  line_total numeric(12,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid DEFAULT auth.uid() NOT NULL,
  customer_name text NOT NULL,
  customer_email text,
  product_id uuid,
  quantity integer DEFAULT 1 NOT NULL,
  total numeric(12,2) DEFAULT 0 NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  order_number integer,
  customer_id uuid,
  customer_phone text,
  shipping_address jsonb,
  notes text DEFAULT ''::text NOT NULL,
  subtotal numeric(12,2) DEFAULT 0 NOT NULL,
  payment_method text DEFAULT 'cod'::text NOT NULL,
  payment_status text DEFAULT 'pending'::text NOT NULL,
  source text DEFAULT 'storefront'::text NOT NULL,
  checkout_key uuid,
  alert_sent_at timestamp with time zone,
  alert_error text,
  cancelled_at timestamp with time zone,
  stock_restored boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.payment_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  processed boolean DEFAULT false NOT NULL
);
CREATE TABLE public.plans (
  id text NOT NULL,
  name text NOT NULL,
  price_monthly integer DEFAULT 0 NOT NULL,
  price_yearly integer DEFAULT 0 NOT NULL,
  product_limit integer,
  order_limit integer,
  storage_mb integer NOT NULL,
  ai_limit integer NOT NULL,
  trial_days integer DEFAULT 0 NOT NULL,
  features jsonb DEFAULT '[]'::jsonb NOT NULL,
  sort integer DEFAULT 0 NOT NULL,
  razorpay_plan_monthly text,
  razorpay_plan_yearly text
);
CREATE TABLE public.products (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid DEFAULT auth.uid() NOT NULL,
  title text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  price numeric(12,2) DEFAULT 0 NOT NULL,
  stock integer DEFAULT 0 NOT NULL,
  category text,
  seo_title text,
  seo_description text,
  seo_keywords text,
  image_path text,
  image_size bigint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  display_name text,
  store_name text DEFAULT 'My Store'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  store_slug text,
  order_alerts boolean DEFAULT true NOT NULL
);
CREATE TABLE public.subscriptions (
  owner_id uuid NOT NULL,
  plan_id text DEFAULT 'free'::text NOT NULL,
  billing_interval text DEFAULT 'monthly'::text NOT NULL,
  status text DEFAULT 'free'::text NOT NULL,
  trial_used boolean DEFAULT false NOT NULL,
  trial_ends_at timestamp with time zone,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean DEFAULT false NOT NULL,
  pending_plan_id text,
  pending_interval text,
  razorpay_subscription_id text,
  razorpay_short_url text,
  last_payment_error text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.whatsapp_connections (
  owner_id uuid NOT NULL,
  phone_number_id text NOT NULL,
  display_phone_number text NOT NULL,
  state text DEFAULT 'active'::text NOT NULL,
  last_error text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.whatsapp_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  recipient text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  purpose text DEFAULT 'general'::text NOT NULL,
  order_id uuid,
  direction text DEFAULT 'outbound'::text NOT NULL,
  state text DEFAULT 'draft'::text NOT NULL,
  provider_id text,
  template_name text,
  language text,
  parameters jsonb DEFAULT '[]'::jsonb NOT NULL,
  media jsonb,
  errors jsonb,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  read_at timestamp with time zone,
  failed_at timestamp with time zone,
  provider_timestamp timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.whatsapp_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  language text DEFAULT 'en_US'::text NOT NULL,
  category text DEFAULT 'UTILITY'::text NOT NULL,
  body text NOT NULL,
  state text DEFAULT 'draft'::text NOT NULL,
  components jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.whatsapp_webhook_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  delivery_id text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL,
  owner_id uuid,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  processing_error text,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Constraints
ALTER TABLE public.ai_requests ADD CONSTRAINT ai_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.ai_service_state ADD CONSTRAINT ai_service_state_pkey PRIMARY KEY (id);
ALTER TABLE public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE public.payment_events ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);
ALTER TABLE public.plans ADD CONSTRAINT plans_pkey PRIMARY KEY (id);
ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (owner_id);
ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_pkey PRIMARY KEY (owner_id);
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_pkey PRIMARY KEY (id);
ALTER TABLE public.whatsapp_webhook_events ADD CONSTRAINT whatsapp_webhook_events_pkey PRIMARY KEY (id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_razorpay_payment_id_key UNIQUE (razorpay_payment_id);
ALTER TABLE public.payment_events ADD CONSTRAINT payment_events_event_id_key UNIQUE (event_id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_razorpay_subscription_id_key UNIQUE (razorpay_subscription_id);
ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_phone_number_id_key UNIQUE (phone_number_id);
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_provider_id_key UNIQUE (provider_id);
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_owner_id_name_language_key UNIQUE (owner_id, name, language);
ALTER TABLE public.whatsapp_webhook_events ADD CONSTRAINT whatsapp_webhook_events_delivery_id_key UNIQUE (delivery_id);
ALTER TABLE public.customers ADD CONSTRAINT customers_notes_len CHECK ((char_length(notes) <= 2000));
ALTER TABLE public.customers ADD CONSTRAINT customers_tags_len CHECK ((cardinality(tags) <= 20));
ALTER TABLE public.order_items ADD CONSTRAINT order_items_quantity_check CHECK (((quantity >= 1) AND (quantity <= 99)));
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check CHECK ((payment_method = 'cod'::text));
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text])));
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'packed'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_store_name_len CHECK (((char_length(store_name) >= 1) AND (char_length(store_name) <= 80)));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_store_slug_format CHECK ((store_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'::text));
ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pending_plan_id_fkey FOREIGN KEY (pending_plan_id) REFERENCES plans(id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id);

-- Indexes
CREATE INDEX ai_requests_owner_id_created_at_idx ON public.ai_requests USING btree (owner_id, created_at DESC);
CREATE INDEX customers_owner_last_idx ON public.customers USING btree (owner_id, last_order_at DESC);
CREATE INDEX order_items_order_idx ON public.order_items USING btree (order_id);
CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id);
CREATE INDEX orders_owner_created_idx ON public.orders USING btree (owner_id, created_at DESC);
CREATE INDEX whatsapp_conversation ON public.whatsapp_messages USING btree (owner_id, recipient, created_at);
CREATE INDEX whatsapp_pending_events ON public.whatsapp_webhook_events USING btree (next_attempt_at) WHERE (processed_at IS NULL);
CREATE UNIQUE INDEX customers_owner_phone_key ON public.customers USING btree (owner_id, phone);
CREATE UNIQUE INDEX invoice_payment_unique ON public.invoices USING btree (razorpay_payment_id);
CREATE UNIQUE INDEX orders_owner_checkout_key ON public.orders USING btree (owner_id, checkout_key);
CREATE UNIQUE INDEX orders_owner_number_key ON public.orders USING btree (owner_id, order_number);
CREATE UNIQUE INDEX payment_event_unique ON public.payment_events USING btree (event_id);
CREATE UNIQUE INDEX profiles_store_slug_key ON public.profiles USING btree (store_slug);
CREATE UNIQUE INDEX subscription_owner_unique ON public.subscriptions USING btree (owner_id);

-- Functions
CREATE OR REPLACE FUNCTION public.begin_plan_trial(_plan text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=auth.uid(); s subscriptions; days integer; ends timestamptz;
BEGIN
IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
SELECT * INTO s FROM subscriptions WHERE owner_id=uid FOR UPDATE;
IF s.owner_id IS NULL THEN RAISE EXCEPTION 'Subscription not found'; END IF;
IF s.trial_used OR s.status IN ('active','past_due') THEN RAISE EXCEPTION 'Trial is not available for this account'; END IF;
SELECT trial_days INTO days FROM plans WHERE id=_plan AND id<>'free';
IF days IS NULL OR days<=0 THEN RAISE EXCEPTION 'Invalid trial plan'; END IF;
ends:=now()+make_interval(days=>days);
UPDATE subscriptions SET plan_id=_plan,status='trialing',trial_used=true,trial_ends_at=ends,updated_at=now() WHERE owner_id=uid;
RETURN ends;
END $function$
;
CREATE OR REPLACE FUNCTION public.effective_plan_id(_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when s.status = 'trialing' and s.trial_ends_at > now() then s.plan_id
      when s.status in ('active','cancelled') and s.current_period_end > now() then s.plan_id
      when s.status = 'past_due' and s.current_period_end + interval '7 days' > now() then s.plan_id
      else 'free' end
    from public.subscriptions s where s.owner_id = _uid), 'free')
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_order_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p plans; cnt int;
begin
  select * into p from plans where id = effective_plan_id(new.owner_id);
  if p.order_limit is not null then
    select count(*) into cnt from orders where owner_id = new.owner_id and created_at >= date_trunc('month', now());
    if cnt >= p.order_limit then
      raise exception 'LIMIT_ORDERS: Your % plan allows % orders per month. Upgrade to take more.', p.name, p.order_limit;
    end if;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.enforce_product_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p plans; cnt int; bytes bigint;
begin
  select * into p from plans where id = effective_plan_id(new.owner_id);
  if tg_op = 'INSERT' and p.product_limit is not null then
    select count(*) into cnt from products where owner_id = new.owner_id;
    if cnt >= p.product_limit then
      raise exception 'LIMIT_PRODUCTS: Your % plan allows % products. Upgrade to add more.', p.name, p.product_limit;
    end if;
  end if;
  if new.image_size > coalesce(case when tg_op='UPDATE' then old.image_size end, 0) then
    select coalesce(sum(image_size),0) into bytes from products where owner_id = new.owner_id and id <> new.id;
    if bytes + new.image_size > p.storage_mb::bigint * 1024 * 1024 then
      raise exception 'LIMIT_STORAGE: Your % plan includes % MB of storage. Upgrade for more.', p.name, p.storage_mb;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.erase_customer(_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.customers SET name = 'Erased customer', email = NULL, phone = NULL, address = NULL, notes = '', tags = '{}', erased_at = now(), updated_at = now()
  WHERE id = _customer_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Customer not found.'; END IF;
  UPDATE public.orders SET customer_name = 'Erased customer', customer_email = NULL, customer_phone = NULL, shipping_address = NULL, notes = '', updated_at = now()
  WHERE customer_id = _customer_id AND owner_id = auth.uid();
END $function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)));
  insert into public.subscriptions (owner_id) values (new.id) on conflict do nothing;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.subscriptions (owner_id, plan_id, billing_interval, status)
  values (new.id, 'free', 'monthly', 'free')
  on conflict (owner_id) do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.lock_merchant_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ BEGIN PERFORM pg_advisory_xact_lock(hashtext(new.owner_id::text)); RETURN new; END $function$
;
CREATE OR REPLACE FUNCTION public.my_usage()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.usage_summary(auth.uid()) || jsonb_build_object('plan_id', public.effective_plan_id(auth.uid()))
$function$
;
CREATE OR REPLACE FUNCTION public.place_order(_slug text, _checkout_key uuid, _customer jsonb, _items jsonb, _notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION public.process_whatsapp_events(_limit integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE e record; v jsonb; s jsonb; m jsonb; uid uuid; t timestamptz; unresolved boolean; state_value text; matched integer; completed integer := 0;
BEGIN
 FOR e IN SELECT * FROM public.whatsapp_webhook_events WHERE processed_at IS NULL AND next_attempt_at <= now() ORDER BY next_attempt_at,received_at LIMIT LEAST(GREATEST(_limit,1),20) FOR UPDATE SKIP LOCKED LOOP
  BEGIN
   v := e.payload #> '{entry,0,changes,0,value}';
   SELECT owner_id INTO uid FROM public.whatsapp_connections WHERE phone_number_id = v #>> '{metadata,phone_number_id}';
   unresolved := false;
   IF uid IS NULL THEN
    UPDATE public.whatsapp_webhook_events SET attempts=attempts+1,processing_error='Number is not bound to a merchant',next_attempt_at=now()+interval '5 minutes' WHERE id=e.id;
    CONTINUE;
   END IF;
   UPDATE public.whatsapp_webhook_events SET owner_id=uid WHERE id=e.id;
   FOR s IN SELECT value FROM jsonb_array_elements(COALESCE(v->'statuses','[]'::jsonb)) LOOP
    t := to_timestamp((s->>'timestamp')::double precision);
    state_value := s->>'status';
    UPDATE public.whatsapp_messages SET
     state=CASE WHEN state_value='read' THEN 'read' WHEN state_value='delivered' AND state<>'read' THEN 'delivered' WHEN state_value='sent' AND state NOT IN ('delivered','read','failed') THEN 'sent' WHEN state_value='failed' AND state NOT IN ('delivered','read') THEN 'failed' ELSE state END,
     sent_at=CASE WHEN state_value='sent' THEN COALESCE(sent_at,t) ELSE sent_at END,
     delivered_at=CASE WHEN state_value='delivered' THEN COALESCE(delivered_at,t) ELSE delivered_at END,
     read_at=CASE WHEN state_value='read' THEN COALESCE(read_at,t) ELSE read_at END,
     failed_at=CASE WHEN state_value='failed' THEN COALESCE(failed_at,t) ELSE failed_at END,
     errors=CASE WHEN s ? 'errors' THEN s->'errors' ELSE errors END
    WHERE provider_id=s->>'id' AND owner_id=uid AND direction='outbound';
    GET DIAGNOSTICS matched = ROW_COUNT;
    IF matched=0 THEN unresolved := true; END IF;
   END LOOP;
   FOR m IN SELECT value FROM jsonb_array_elements(COALESCE(v->'messages','[]'::jsonb)) LOOP
    INSERT INTO public.whatsapp_messages(owner_id,recipient,body,direction,state,provider_id,media,provider_timestamp)
    VALUES(uid,m->>'from',COALESCE(m #>> '{text,body}',m #>> '{image,caption}',m #>> '{document,caption}',''),'inbound','received',m->>'id',CASE WHEN m->>'type' IN ('image','document','audio','video','sticker') THEN jsonb_build_object('type',m->>'type','data',m->(m->>'type')) ELSE NULL END,to_timestamp((m->>'timestamp')::double precision)) ON CONFLICT(provider_id) DO NOTHING;
   END LOOP;
   IF e.event='whatsapp.template_status' THEN
    UPDATE public.whatsapp_templates SET state=lower(v->>'event') WHERE owner_id=uid AND name=v->>'message_template_name';
   END IF;
   IF e.event='whatsapp.account_update' THEN
    IF v->>'event' IN ('PARTNER_REMOVED','PARTNER_APP_UNINSTALLED','ACCOUNT_OFFBOARDED') OR (v->>'event'='DISABLED_UPDATE' AND v #>> '{ban_info,waba_ban_state}'='DISABLE') OR (v->>'event'='ACCOUNT_DELETED' AND regexp_replace(v->>'phone_number','[^0-9]','','g')=(SELECT regexp_replace(display_phone_number,'[^0-9]','','g') FROM public.whatsapp_connections WHERE owner_id=uid)) THEN
     UPDATE public.whatsapp_connections SET state='paused',last_error=v->>'event',updated_at=now() WHERE owner_id=uid;
    ELSIF v->>'event'='ACCOUNT_RECONNECTED' THEN
     UPDATE public.whatsapp_connections SET state='active',last_error=NULL,updated_at=now() WHERE owner_id=uid;
    END IF;
   END IF;
   UPDATE public.whatsapp_webhook_events SET processed_at=CASE WHEN unresolved THEN NULL ELSE now() END, processing_error=CASE WHEN unresolved THEN 'Awaiting outbound message record' ELSE NULL END, attempts=attempts+1,next_attempt_at=now()+interval '1 minute' WHERE id=e.id;
   IF NOT unresolved THEN completed:=completed+1; END IF;
  EXCEPTION WHEN OTHERS THEN
   UPDATE public.whatsapp_webhook_events SET processing_error=SQLERRM,attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=e.id;
  END;
 END LOOP;
 RETURN completed;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.profiles_fill_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF new.store_slug IS NULL OR btrim(new.store_slug) = '' THEN
    new.store_slug := 'store-' || substr(replace(new.id::text, '-', ''), 1, 8);
  END IF;
  new.store_slug := lower(btrim(new.store_slug));
  new.store_name := btrim(new.store_name);
  RETURN new;
END $function$
;
CREATE OR REPLACE FUNCTION public.reconcile_whatsapp_message(_provider_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 UPDATE public.whatsapp_webhook_events SET next_attempt_at=now() WHERE processed_at IS NULL AND payload #> '{entry,0,changes,0,value,statuses}' @> jsonb_build_array(jsonb_build_object('id',_provider_id));
 PERFORM public.process_whatsapp_events(20);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reserve_ai_request(_kind text, _input jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); p public.plans; cnt integer; feature text; rid uuid;
BEGIN
IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
PERFORM pg_advisory_xact_lock(hashtext(uid::text));
SELECT * INTO p FROM plans WHERE id=effective_plan_id(uid);
feature := CASE WHEN _kind IN ('title','description','seo','category') THEN 'basic_ai' WHEN _kind='image_extract' THEN 'image_ai' WHEN _kind IN ('marketing','social') THEN 'marketing_ai' WHEN _kind='recommendations' THEN 'recommendations' ELSE NULL END;
IF feature IS NULL THEN RAISE EXCEPTION 'Unknown AI tool'; END IF;
IF NOT p.features ? feature THEN RAISE EXCEPTION 'Your plan does not include this AI tool. Upgrade your plan.'; END IF;
IF EXISTS(SELECT 1 FROM ai_service_state WHERE blocked) THEN RAISE EXCEPTION 'AI is paused. The store owner must restore AI access before starting a new request.'; END IF;
SELECT count(*) INTO cnt FROM ai_requests WHERE owner_id=uid AND status IN ('success','pending') AND created_at>=date_trunc('month',now());
IF cnt>=p.ai_limit THEN RAISE EXCEPTION 'Monthly AI usage limit reached. Upgrade your plan or wait for next month.'; END IF;
INSERT INTO ai_requests(owner_id,kind,input,status) VALUES(uid,_kind,_input,'pending') RETURNING id INTO rid;
RETURN rid;
END $function$
;
CREATE OR REPLACE FUNCTION public.set_order_status(_order_id uuid, _status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION public.storefront(_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'store_name', p.store_name,
    'slug', p.store_slug,
    'products', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'description', x.description, 'price', x.price, 'category', x.category, 'available', least(greatest(x.stock, 0), 99)) ORDER BY x.title)
      FROM public.products x WHERE x.owner_id = p.id), '[]'::jsonb))
  FROM public.profiles p WHERE p.store_slug = lower(btrim(_slug))
$function$
;
CREATE OR REPLACE FUNCTION public.usage_summary(_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'products', (select count(*) from products where owner_id = _uid),
    'orders_month', (select count(*) from orders where owner_id = _uid and created_at >= date_trunc('month', now())),
    'storage_bytes', (select coalesce(sum(image_size),0) from products where owner_id = _uid),
    'ai_month', (select count(*) from ai_requests where owner_id = _uid and status = 'success' and created_at >= date_trunc('month', now()))
  )
$function$
;

-- Triggers
CREATE TRIGGER a_lock_merchant_limits BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION lock_merchant_limits();
CREATE TRIGGER a_lock_merchant_limits BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION lock_merchant_limits();
CREATE TRIGGER a_order_limit_lock BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION lock_merchant_limits();
CREATE TRIGGER a_product_limit_lock BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION lock_merchant_limits();
CREATE TRIGGER b_enforce_order_limits BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION enforce_order_limits();
CREATE TRIGGER b_enforce_product_limits BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION enforce_product_limits();
CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER on_auth_user_created_subscription AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user_subscription();
CREATE TRIGGER orders_limits BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION enforce_order_limits();
CREATE TRIGGER products_limits BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION enforce_product_limits();
CREATE TRIGGER profiles_fill_slug BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_fill_slug();

-- Row level security
ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_service_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai read" ON public.ai_requests AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = owner_id));
CREATE POLICY "own customers read" ON public.customers AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = auth.uid()));
CREATE POLICY "own customers update" ON public.customers AS PERMISSIVE FOR UPDATE TO authenticated USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY "own invoices read" ON public.invoices AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = owner_id));
CREATE POLICY "own order items read" ON public.order_items AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = auth.uid()));
CREATE POLICY "own orders" ON public.orders AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));
CREATE POLICY "plans readable" ON public.plans AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "own products" ON public.products AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));
CREATE POLICY "own profile read" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = id));
CREATE POLICY "own profile update" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "own sub read" ON public.subscriptions AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = owner_id));
CREATE POLICY "own whatsapp connection" ON public.whatsapp_connections AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = auth.uid()));
CREATE POLICY "own whatsapp drafts delete" ON public.whatsapp_messages AS PERMISSIVE FOR DELETE TO authenticated USING (((owner_id = auth.uid()) AND (state = 'draft'::text)));
CREATE POLICY "own whatsapp drafts insert" ON public.whatsapp_messages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((owner_id = auth.uid()) AND (state = 'draft'::text) AND (direction = 'outbound'::text) AND (provider_id IS NULL)));
CREATE POLICY "own whatsapp drafts update" ON public.whatsapp_messages AS PERMISSIVE FOR UPDATE TO authenticated USING (((owner_id = auth.uid()) AND (state = 'draft'::text))) WITH CHECK (((owner_id = auth.uid()) AND (state = 'draft'::text) AND (direction = 'outbound'::text) AND (provider_id IS NULL)));
CREATE POLICY "own whatsapp messages read" ON public.whatsapp_messages AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = auth.uid()));
CREATE POLICY "own template drafts delete" ON public.whatsapp_templates AS PERMISSIVE FOR DELETE TO authenticated USING (((owner_id = auth.uid()) AND (state = 'draft'::text)));
CREATE POLICY "own template drafts insert" ON public.whatsapp_templates AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((owner_id = auth.uid()) AND (state = 'draft'::text)));
CREATE POLICY "own template drafts update" ON public.whatsapp_templates AS PERMISSIVE FOR UPDATE TO authenticated USING (((owner_id = auth.uid()) AND (state = 'draft'::text))) WITH CHECK (((owner_id = auth.uid()) AND (state = 'draft'::text)));
CREATE POLICY "own templates read" ON public.whatsapp_templates AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = auth.uid()));
CREATE POLICY "own whatsapp deliveries" ON public.whatsapp_webhook_events AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = auth.uid()));

-- Table grants

-- Function execute grants

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
