import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Display-only session flag for public pages (e.g. header buttons). */
export function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSignedIn(!!data.session); });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return signedIn;
}
