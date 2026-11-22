import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { LovableMark } from '@lovable.dev/cloud-auth-js/react';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/storva-brand';
import { pageHead, steps } from '@/lib/storva';
import { safeRedirect } from '@/lib/auth-redirect';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';

type Search = { redirect?: string | undefined };
type Mode = 'login' | 'signup' | 'forgot' | 'link';

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): Search => (typeof s['redirect'] === 'string' ? { redirect: s['redirect'] } : {}),
  head: () => pageHead('Welcome back', 'Log in or create your STORVA account to manage your online store.'),
  component: Login,
});

const REDIRECT_KEY = 'storva-after-login';

function GoogleLogo() {
  return <svg aria-hidden="true" width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>;
}

function Login() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');

  const destination = () => safeRedirect(search.redirect ?? sessionStorage.getItem(REDIRECT_KEY));
  function goToStore() {
    const to = destination();
    sessionStorage.removeItem(REDIRECT_KEY);
    void navigate({ to, replace: true });
  }

  // Already signed in (or returning from Google / Lovable / an email link): continue to the store.
  useEffect(() => {
    if (search.redirect) sessionStorage.setItem(REDIRECT_KEY, safeRedirect(search.redirect));
    supabase.auth.getSession().then(({ data }) => { if (data.session) goToStore(); });
    const { data } = supabase.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_IN' && session) goToStore(); });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchMode(next: Mode) { setMode(next); setNotice(null); }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const cleanEmail = email.trim();
    const returnUrl = `${window.location.origin}/login`;
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) setNotice({ tone: 'error', text: error.message === 'Invalid login credentials' ? 'That email and password don’t match. Please try again.' : error.message });
      } else if (mode === 'signup') {
        if (password.length < 8) { setNotice({ tone: 'error', text: 'Choose a password with at least 8 characters.' }); return; }
        const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password, options: { emailRedirectTo: returnUrl, data: { full_name: fullName.trim(), mobile: mobile.trim() } } });
        if (error) setNotice({ tone: 'error', text: error.message });
        else if (!data.session) setNotice({ tone: 'info', text: `Almost there. We sent a confirmation link to ${cleanEmail}. Open it to finish creating your account.` });
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) setNotice({ tone: 'error', text: error.message });
        else setNotice({ tone: 'info', text: `If an account exists for ${cleanEmail}, a reset link is on its way.` });
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email: cleanEmail, options: { shouldCreateUser: false, emailRedirectTo: returnUrl } });
        if (error) setNotice({ tone: 'error', text: error.message });
        else setNotice({ tone: 'info', text: `Check ${cleanEmail} for your login link.` });
      }
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: 'google' | 'lovable') {
    setNotice(null);
    const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: `${window.location.origin}/login` });
    if (result.error) { setNotice({ tone: 'error', text: 'Sign-in didn’t finish. Please try again.' }); return; }
    if (result.redirected) return;
    goToStore();
  }

  const title = mode === 'signup' ? 'Your next chapter.' : mode === 'forgot' ? 'Reset your password.' : mode === 'link' ? 'Log in with a link.' : 'Welcome back.';
  const subtitle = mode === 'signup' ? 'Create your account. Start with the essentials.' : mode === 'login' ? 'Your store is waiting for you.' : mode === 'forgot' ? 'Enter your email and we’ll send you a reset link.' : 'Enter your email and we’ll send you a one-tap login link.';
  const submitLabel = mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Send login link';

  return <main className="login-page">
    <section className="login-story"><Link to="/" aria-label="STORVA home"><Brand /></Link><div><span className="eyebrow">YOUR BUSINESS. YOUR WAY.</span><h2>Good things start<br />with a small step.</h2><p>A store that feels like you.<br />A simpler way to run it.</p><img src={steps[0]?.image} alt="Setting up a STORVA store" /></div><p className="small">Built for creators, makers and small businesses.</p></section>
    <section className="login-form-area">
      <Button asChild variant="ghost" className="login-back"><Link to="/"><ArrowLeft /> Back to home</Link></Button>
      <div className="login-form">
        <div className="mobile-brand"><Brand /></div>
        <span className="login-icon"><LockKeyhole /></span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {(mode === 'login' || mode === 'signup') && <><div className="social-buttons">
          <Button type="button" variant="outline" className="google-button" onClick={() => void social('google')}><GoogleLogo />Continue with Google</Button>
          <Button type="button" variant="outline" onClick={() => void social('lovable')}><LovableMark />Continue with Lovable</Button>
        </div><div className="auth-divider"><span>or use your email</span></div></>}
        <form onSubmit={onSubmit}>
          {mode === 'signup' && <label>Your name<input required autoComplete="name" placeholder="Your full name" maxLength={80} value={fullName} onChange={e => setFullName(e.target.value)} /></label>}
          <label>Email address<input required type="email" autoComplete="email" placeholder="you@example.com" maxLength={255} value={email} onChange={e => setEmail(e.target.value)} /></label>
          {mode === 'signup' && <label>Mobile number<input required type="tel" placeholder="+91" autoComplete="tel" maxLength={20} value={mobile} onChange={e => setMobile(e.target.value)} /></label>}
          {(mode === 'login' || mode === 'signup') && <label>Password<div className="password-field"><input required type={visible ? 'text' : 'password'} minLength={mode === 'signup' ? 8 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'} value={password} onChange={e => setPassword(e.target.value)} /><Button type="button" variant="ghost" size="icon" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</Button></div></label>}
          {mode === 'login' && <Button type="button" variant="link" className="forgot-link" onClick={() => switchMode('forgot')}>Forgot password?</Button>}
          <Button type="submit" size="lg" disabled={busy}>{busy ? 'Please wait…' : submitLabel} <ArrowRight /></Button>
          {notice && <p className={notice.tone === 'error' ? 'form-notice form-error' : 'form-notice'} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
        </form>
        <div className="auth-links">{mode === 'login' ? <><span>New to STORVA? <Button variant="link" onClick={() => switchMode('signup')}>Create an account</Button></span><Button variant="link" onClick={() => switchMode('link')}>Email me a login link</Button></> : <span>{mode === 'signup' ? 'Already have an account? ' : ''}<Button variant="link" onClick={() => switchMode('login')}>Back to login</Button></span>}</div>
      </div>
      <p className="login-copyright">© 2026 STORVA</p>
    </section>
  </main>;
}
