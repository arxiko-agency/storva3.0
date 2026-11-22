import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/storva-brand';
import { pageHead, steps } from '@/lib/storva';
import { supabase } from '@/integrations/supabase/client';

export const Route = createFileRoute('/reset-password')({
  head: () => pageHead('Choose a new password', 'Set a new password for your STORVA account.'),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const isRecovery = window.location.hash.includes('type=recovery');
    const { data } = supabase.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') setReady(true); });
    supabase.auth.getSession().then(({ data: s }) => { if (s.session && isRecovery) setReady(true); else if (s.session) setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setNotice({ tone: 'error', text: 'Choose a password with at least 8 characters.' }); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setNotice({ tone: 'error', text: error.message }); return; }
    void navigate({ to: '/dashboard', replace: true });
  }

  return <main className="login-page">
    <section className="login-story"><Link to="/" aria-label="STORVA home"><Brand /></Link><div><span className="eyebrow">A FRESH START</span><h2>Back in a<br />moment.</h2><p>Choose a new password and<br />pick up where you left off.</p><img src={steps[0]?.image} alt="Setting up a STORVA store" /></div><p className="small">Built for creators, makers and small businesses.</p></section>
    <section className="login-form-area"><div className="login-form">
      <div className="mobile-brand"><Brand /></div>
      <span className="login-icon"><KeyRound /></span>
      <h1>Choose a new password.</h1>
      {ready ? <><p>Use at least 8 characters.</p><form onSubmit={onSubmit}>
        <label>New password<input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <Button type="submit" size="lg" disabled={busy}>{busy ? 'Saving…' : 'Save new password'} <ArrowRight /></Button>
        {notice && <p className={notice.tone === 'error' ? 'form-notice form-error' : 'form-notice'} role="alert">{notice.text}</p>}
      </form></> : <><p>Open this page from the reset link in your email. Links expire after a while — you can request a new one.</p><Button asChild variant="outline"><Link to="/login">Back to login</Link></Button></>}
    </div><p className="login-copyright">© 2026 STORVA</p></section>
  </main>;
}
