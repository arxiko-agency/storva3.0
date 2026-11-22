-- STORVA: allow the AI "Price suggestion" tool (kind = 'pricing') on plans that include basic AI.
CREATE OR REPLACE FUNCTION public.reserve_ai_request(_kind text, _input jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); p public.plans; cnt integer; feature text; rid uuid;
BEGIN
IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
PERFORM pg_advisory_xact_lock(hashtext(uid::text));
SELECT * INTO p FROM plans WHERE id=effective_plan_id(uid);
feature := CASE WHEN _kind IN ('title','description','seo','category','pricing') THEN 'basic_ai' WHEN _kind='image_extract' THEN 'image_ai' WHEN _kind IN ('marketing','social') THEN 'marketing_ai' WHEN _kind='recommendations' THEN 'recommendations' ELSE NULL END;
IF feature IS NULL THEN RAISE EXCEPTION 'Unknown AI tool'; END IF;
IF NOT p.features ? feature THEN RAISE EXCEPTION 'Your plan does not include this AI tool. Upgrade your plan.'; END IF;
IF EXISTS(SELECT 1 FROM ai_service_state WHERE blocked) THEN RAISE EXCEPTION 'AI is paused. The store owner must restore AI access before starting a new request.'; END IF;
SELECT count(*) INTO cnt FROM ai_requests WHERE owner_id=uid AND status IN ('success','pending') AND created_at>=date_trunc('month',now());
IF cnt>=p.ai_limit THEN RAISE EXCEPTION 'Monthly AI usage limit reached. Upgrade your plan or wait for next month.'; END IF;
INSERT INTO ai_requests(owner_id,kind,input,status) VALUES(uid,_kind,_input,'pending') RETURNING id INTO rid;
RETURN rid;
END $$;

REVOKE ALL ON FUNCTION public.reserve_ai_request(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_request(text, jsonb) TO authenticated;
