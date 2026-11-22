
-- ========== Tables ==========
CREATE TABLE public.plans (
  id text PRIMARY KEY, name text NOT NULL,
  price_monthly integer NOT NULL DEFAULT 0, price_yearly integer NOT NULL DEFAULT 0,
  product_limit integer, order_limit integer, storage_mb integer NOT NULL, ai_limit integer NOT NULL,
  trial_days integer NOT NULL DEFAULT 0, features jsonb NOT NULL DEFAULT '[]'::jsonb, sort integer NOT NULL DEFAULT 0,
  razorpay_plan_monthly text, razorpay_plan_yearly text
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text, store_name text NOT NULL DEFAULT 'My Store',
  created_at timestamptz NOT NULL DEFAULT now(), store_slug text, order_alerts boolean NOT NULL DEFAULT true,
  CONSTRAINT profiles_store_name_len CHECK (char_length(store_name) BETWEEN 1 AND 80),
  CONSTRAINT profiles_store_slug_format CHECK (store_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
);
CREATE UNIQUE INDEX profiles_store_slug_key ON public.profiles (store_slug);
CREATE TABLE public.subscriptions (
  owner_id uuid PRIMARY KEY, plan_id text NOT NULL DEFAULT 'free' REFERENCES public.plans(id),
  billing_interval text NOT NULL DEFAULT 'monthly', status text NOT NULL DEFAULT 'free',
  trial_used boolean NOT NULL DEFAULT false, trial_ends_at timestamptz,
  current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  pending_plan_id text REFERENCES public.plans(id), pending_interval text,
  razorpay_subscription_id text UNIQUE, razorpay_short_url text, last_payment_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
  razorpay_payment_id text UNIQUE, razorpay_invoice_id text, plan_id text,
  amount integer NOT NULL, currency text NOT NULL DEFAULT 'INR', status text NOT NULL,
  invoice_url text, failure_reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text NOT NULL UNIQUE, event_type text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), processed boolean NOT NULL DEFAULT false
);
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL, description text NOT NULL DEFAULT '', price numeric(12,2) NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0, category text, seo_title text, seo_description text, seo_keywords text,
  image_path text, image_size bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_owner_idx ON public.products (owner_id);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, name text NOT NULL,
  email text, phone text, address jsonb, tags text[] NOT NULL DEFAULT '{}', notes text NOT NULL DEFAULT '',
  order_count integer NOT NULL DEFAULT 0, total_spent numeric(12,2) NOT NULL DEFAULT 0,
  first_order_at timestamptz, last_order_at timestamptz, erased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_notes_len CHECK (char_length(notes) <= 2000),
  CONSTRAINT customers_tags_len CHECK (cardinality(tags) <= 20)
);
CREATE UNIQUE INDEX customers_owner_phone_key ON public.customers (owner_id, phone);
CREATE INDEX customers_owner_last_idx ON public.customers (owner_id, last_order_at DESC);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid(),
  customer_name text NOT NULL, customer_email text, product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 1, total numeric(12,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(), order_number integer,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL, customer_phone text, shipping_address jsonb,
  notes text NOT NULL DEFAULT '', subtotal numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cod', payment_status text NOT NULL DEFAULT 'pending',
  source text NOT NULL DEFAULT 'storefront', checkout_key uuid, alert_sent_at timestamptz, alert_error text,
  cancelled_at timestamptz, stock_restored boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_payment_method_check CHECK (payment_method = 'cod'),
  CONSTRAINT orders_payment_status_check CHECK (payment_status IN ('pending','paid','refunded')),
  CONSTRAINT orders_status_check CHECK (status IN ('pending','confirmed','packed','shipped','delivered','cancelled'))
);
CREATE INDEX orders_customer_idx ON public.orders (customer_id);
CREATE INDEX orders_owner_created_idx ON public.orders (owner_id, created_at DESC);
CREATE UNIQUE INDEX orders_owner_checkout_key ON public.orders (owner_id, checkout_key);
CREATE UNIQUE INDEX orders_owner_number_key ON public.orders (owner_id, order_number);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL, product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  title text NOT NULL, unit_price numeric(12,2) NOT NULL, quantity integer NOT NULL, line_total numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_quantity_check CHECK (quantity BETWEEN 1 AND 99)
);
CREATE INDEX order_items_order_idx ON public.order_items (order_id);
CREATE TABLE public.ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, kind text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb, output jsonb, status text NOT NULL, error text,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX ai_requests_owner_id_created_at_idx ON public.ai_requests (owner_id, created_at DESC);
CREATE TABLE public.ai_service_state (
  id text PRIMARY KEY DEFAULT 'gateway', reason text NOT NULL, status_code integer NOT NULL,
  blocked boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.whatsapp_connections (
  owner_id uuid PRIMARY KEY, phone_number_id text NOT NULL UNIQUE, display_phone_number text NOT NULL,
  state text NOT NULL DEFAULT 'active', last_error text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, recipient text NOT NULL,
  body text NOT NULL DEFAULT '', purpose text NOT NULL DEFAULT 'general', order_id uuid,
  direction text NOT NULL DEFAULT 'outbound', state text NOT NULL DEFAULT 'draft', provider_id text UNIQUE,
  template_name text, language text, parameters jsonb NOT NULL DEFAULT '[]'::jsonb, media jsonb, errors jsonb,
  sent_at timestamptz, delivered_at timestamptz, read_at timestamptz, failed_at timestamptz,
  provider_timestamp timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_conversation ON public.whatsapp_messages (owner_id, recipient, created_at);
CREATE TABLE public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, name text NOT NULL,
  language text NOT NULL DEFAULT 'en_US', category text NOT NULL DEFAULT 'UTILITY', body text NOT NULL,
  state text NOT NULL DEFAULT 'draft', components jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (owner_id, name, language)
);
CREATE TABLE public.whatsapp_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id text NOT NULL UNIQUE, event text NOT NULL,
  payload jsonb NOT NULL, owner_id uuid, received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz, processing_error text, attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_pending_events ON public.whatsapp_webhook_events (next_attempt_at) WHERE processed_at IS NULL;

-- ========== Grants ==========
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT ON public.invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT ON public.customers TO authenticated;
GRANT UPDATE (notes, tags, updated_at) ON public.customers TO authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.order_items TO authenticated;
GRANT SELECT ON public.ai_requests TO authenticated;
GRANT SELECT ON public.whatsapp_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT SELECT ON public.whatsapp_webhook_events TO authenticated;
GRANT ALL ON public.plans, public.profiles, public.subscriptions, public.invoices, public.payment_events, public.products,
  public.customers, public.orders, public.order_items, public.ai_requests, public.ai_service_state,
  public.whatsapp_connections, public.whatsapp_messages, public.whatsapp_templates, public.whatsapp_webhook_events TO service_role;

-- ========== RLS ==========
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_service_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans readable" ON public.plans FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "own sub read" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "own invoices read" ON public.invoices FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "own products" ON public.products FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "own customers read" ON public.customers FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own customers update" ON public.customers FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own orders" ON public.orders FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "own order items read" ON public.order_items FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own ai read" ON public.ai_requests FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "own whatsapp connection" ON public.whatsapp_connections FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own whatsapp messages read" ON public.whatsapp_messages FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own whatsapp drafts insert" ON public.whatsapp_messages FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND state = 'draft' AND direction = 'outbound' AND provider_id IS NULL);
CREATE POLICY "own whatsapp drafts update" ON public.whatsapp_messages FOR UPDATE TO authenticated USING (owner_id = auth.uid() AND state = 'draft') WITH CHECK (owner_id = auth.uid() AND state = 'draft' AND direction = 'outbound' AND provider_id IS NULL);
CREATE POLICY "own whatsapp drafts delete" ON public.whatsapp_messages FOR DELETE TO authenticated USING (owner_id = auth.uid() AND state = 'draft');
CREATE POLICY "own templates read" ON public.whatsapp_templates FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own template drafts insert" ON public.whatsapp_templates FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND state = 'draft');
CREATE POLICY "own template drafts update" ON public.whatsapp_templates FOR UPDATE TO authenticated USING (owner_id = auth.uid() AND state = 'draft') WITH CHECK (owner_id = auth.uid() AND state = 'draft');
CREATE POLICY "own template drafts delete" ON public.whatsapp_templates FOR DELETE TO authenticated USING (owner_id = auth.uid() AND state = 'draft');
CREATE POLICY "own whatsapp deliveries" ON public.whatsapp_webhook_events FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- ========== Functions ==========
CREATE OR REPLACE FUNCTION public.effective_plan_id(_uid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select coalesce((
    select case
      when s.status = 'trialing' and s.trial_ends_at > now() then s.plan_id
      when s.status in ('active','cancelled') and s.current_period_end > now() then s.plan_id
      when s.status = 'past_due' and s.current_period_end + interval '7 days' > now() then s.plan_id
      else 'free' end
    from public.subscriptions s where s.owner_id = _uid), 'free')
$$;

CREATE OR REPLACE FUNCTION public.begin_plan_trial(_plan text) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.enforce_order_limits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
end $$;

CREATE OR REPLACE FUNCTION public.enforce_product_limits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
end $$;

CREATE OR REPLACE FUNCTION public.lock_merchant_limits() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtext(new.owner_id::text)); RETURN new; END $$;

CREATE OR REPLACE FUNCTION public.erase_customer(_customer_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.customers SET name = 'Erased customer', email = NULL, phone = NULL, address = NULL, notes = '', tags = '{}', erased_at = now(), updated_at = now()
  WHERE id = _customer_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Customer not found.'; END IF;
  UPDATE public.orders SET customer_name = 'Erased customer', customer_email = NULL, customer_phone = NULL, shipping_address = NULL, notes = '', updated_at = now()
  WHERE customer_id = _customer_id AND owner_id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  insert into public.subscriptions (owner_id, plan_id, billing_interval, status) values (new.id, 'free', 'monthly', 'free') on conflict (owner_id) do nothing;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.profiles_fill_slug() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF new.store_slug IS NULL OR btrim(new.store_slug) = '' THEN
    new.store_slug := 'store-' || substr(replace(new.id::text, '-', ''), 1, 8);
  END IF;
  new.store_slug := lower(btrim(new.store_slug));
  new.store_name := btrim(new.store_name);
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.usage_summary(_uid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select jsonb_build_object(
    'products', (select count(*) from products where owner_id = _uid),
    'orders_month', (select count(*) from orders where owner_id = _uid and created_at >= date_trunc('month', now())),
    'storage_bytes', (select coalesce(sum(image_size),0) from products where owner_id = _uid),
    'ai_month', (select count(*) from ai_requests where owner_id = _uid and status = 'success' and created_at >= date_trunc('month', now()))
  )
$$;

CREATE OR REPLACE FUNCTION public.my_usage() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select public.usage_summary(auth.uid()) || jsonb_build_object('plan_id', public.effective_plan_id(auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.reserve_ai_request(_kind text, _input jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.process_whatsapp_events(_limit integer DEFAULT 10) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_whatsapp_message(_provider_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
 UPDATE public.whatsapp_webhook_events SET next_attempt_at=now() WHERE processed_at IS NULL AND payload #> '{entry,0,changes,0,value,statuses}' @> jsonb_build_array(jsonb_build_object('id',_provider_id));
 PERFORM public.process_whatsapp_events(20);
END $$;

-- ========== Triggers ==========
CREATE TRIGGER a_lock_merchant_limits BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.lock_merchant_limits();
CREATE TRIGGER a_lock_merchant_limits BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.lock_merchant_limits();
CREATE TRIGGER b_enforce_order_limits BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_order_limits();
CREATE TRIGGER b_enforce_product_limits BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_product_limits();
CREATE TRIGGER profiles_fill_slug BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_fill_slug();
CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========== Function execute grants ==========
REVOKE ALL ON FUNCTION public.effective_plan_id(uuid), public.usage_summary(uuid), public.process_whatsapp_events(integer),
  public.enforce_order_limits(), public.enforce_product_limits(), public.lock_merchant_limits(), public.handle_new_user(), public.profiles_fill_slug() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_plan_trial(text), public.my_usage(), public.reserve_ai_request(text, jsonb), public.erase_customer(uuid), public.reconcile_whatsapp_message(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_plan_trial(text), public.my_usage(), public.reserve_ai_request(text, jsonb), public.erase_customer(uuid), public.reconcile_whatsapp_message(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_plan_id(uuid), public.usage_summary(uuid), public.process_whatsapp_events(integer), public.reconcile_whatsapp_message(text) TO service_role;

-- ========== Seed plans ==========
insert into public.plans (id, name, price_monthly, price_yearly, product_limit, order_limit, storage_mb, ai_limit, trial_days, features, sort) values
  ('free', 'Free', 0, 0, 10, 50, 100, 20, 0, '["basic_ai"]'::jsonb, 0),
  ('starter', 'Starter', 49900, 499000, 100, 500, 1024, 200, 14, '["basic_ai","image_ai"]'::jsonb, 1),
  ('pro', 'Pro', 149900, 1499000, 1000, 5000, 10240, 1000, 14, '["basic_ai","image_ai","marketing_ai"]'::jsonb, 2),
  ('enterprise', 'Enterprise', 499900, 4999000, null, null, 102400, 5000, 14, '["basic_ai","image_ai","marketing_ai","recommendations"]'::jsonb, 3)
on conflict (id) do nothing;

-- ========== Realtime ==========
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
