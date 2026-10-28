import React, { useId, useRef, useState } from 'react';
import { X, Mail, Lock, User as UserIcon, Loader2, ArrowRight, Layers } from 'lucide-react';
import { Tip } from './settings/Tip';
import { authService } from '../services/authService';
import { User } from '../types';
import { getAuthFormBlocker, getAuthFormBlockerField, type AuthFormField } from '../utils/formValidation';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
  initialMode?: 'login' | 'signup';
  hasPendingImage?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  initialMode = 'login',
  hasPendingImage = false,
}) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<AuthFormField | null>(null);
  const errorId = useId();
  const [errorAttempt, setErrorAttempt] = useState(0);
  const fieldRefs = useRef<Partial<Record<AuthFormField, HTMLInputElement | null>>>({});
  const [status, setStatus] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const busyRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeReasonId = useId();
  const resetReasonId = useId();
  const submitReasonId = useId();

  React.useLayoutEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [isOpen]);
  
  // Reset mode when modal opens with a new initialMode
  React.useEffect(() => {
    setIsLogin(initialMode === 'login');
    setError(null);
    setErrorField(null);
    setStatus(null);
    setIsLoading(false);
    setIsResetting(false);
    isSubmittingRef.current = false;
  }, [initialMode, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLInputElement>('input:not([disabled]):not([type="hidden"])')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  React.useEffect(() => {
    if (!error || !errorField) return;
    const field = fieldRefs.current[errorField];
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: 'center' });
  }, [error, errorField, errorAttempt]);

  // Form State
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // While a sign-in or reset request is running, Esc and backdrop clicks are
  // ignored, like FeedbackModal does while it is sending.
  busyRef.current = isLoading || isResetting;

  React.useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (busyRef.current) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.matches('input,textarea,[contenteditable="true"]')) {
        target.blur();
        panelRef.current?.focus();
        return;
      }
      onClose();
    };
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const tabbable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, a[href], [tabindex], [contenteditable="true"]'
      )).filter((element) => element.tabIndex >= 0
        && !element.matches(':disabled')
        && !element.closest('[hidden], [inert], [aria-hidden="true"]')
        && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden');
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      const active = document.activeElement;
      if (!first) {
        event.preventDefault();
        panel.focus();
      } else if (!tabbable.includes(active as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleEscape, true);
    document.addEventListener('keydown', handleTab, true);
    return () => {
      document.removeEventListener('keydown', handleEscape, true);
      document.removeEventListener('keydown', handleTab, true);
    };
  }, [isOpen, onClose]);

  const busy = isLoading || isResetting;
  const resetDisabled = busy || !email.trim();
  const resetTip = busy ? 'Wait for the request to finish' : !email.trim() ? 'Enter your email or username first' : 'Forgot password?';
  const submitDisabled = busy || !email.trim() || !password || (!isLogin && (!name.trim() || !username.trim()));
  const submitTip = busy ? 'Wait for the request to finish'
    : submitDisabled ? isLogin ? 'Enter your email and password first' : 'Enter your name, username, email and password first'
    : isLogin ? 'Log in' : 'Create account';

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || isSubmittingRef.current) return;
    const blocker = getAuthFormBlocker({ isLogin, name, username, email, password });
    if (blocker) {
      setErrorAttempt(attempt => attempt + 1);
      setError(blocker);
      setErrorField(getAuthFormBlockerField({ isLogin, name, username, email, password }));
      setStatus(null);
      return;
    }
    isSubmittingRef.current = true;
    busyRef.current = true;
    setError(null);
    setErrorField(null);
    setStatus(null);
    setIsLoading(true);

    try {
      let user: User;
      if (isLogin) {
        user = await authService.login(email, password);
      } else {
        if (!name) throw new Error("Name is required");
        if (!username) throw new Error("Username is required.");
        user = await authService.register(name, email, password, username);
      }
      onLoginSuccess(user);
      onClose();
    } catch (err: any) {
      setError(err.message || "Authentication failed.");
    } finally {
      isSubmittingRef.current = false;
      busyRef.current = false;
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (busyRef.current) return;
    if (!email.trim()) {
      setErrorAttempt(attempt => attempt + 1);
      setError('Enter your email or username first.');
      setErrorField('email');
      setStatus(null);
      return;
    }

    setError(null);
    setErrorField(null);
    setStatus(null);
    busyRef.current = true;
    setIsResetting(true);
    try {
      await authService.requestPasswordReset(email);
      setStatus('Check your email for a password reset link.');
    } catch (err: any) {
      setError(err.message || 'Could not send the password reset email.');
    } finally {
      busyRef.current = false;
      setIsResetting(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError(null);
    setErrorField(null);
    setStatus(null);
    setPassword('');
  };

  return (
    <div onMouseDown={(event) => {
      // Presses on the backdrop's own scrollbar must not close the dialog.
      const onScrollbar = event.clientX >= event.currentTarget.clientWidth || event.clientY >= event.currentTarget.clientHeight;
      if (event.target === event.currentTarget && !onScrollbar && !busyRef.current) onClose();
    }} className="fixed inset-0 z-[100] flex justify-center overflow-y-auto p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={isLogin ? "Log in" : "Create account"} className="outline-none bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl w-full max-w-md m-auto shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
        
        <span className="absolute top-4 right-4 z-10 inline-flex">
        <span className="relative inline-flex">
        <button
          type="button"
          onClick={() => { if (!busyRef.current) onClose(); }}
          aria-disabled={busy}
          aria-describedby={busy ? closeReasonId : undefined}
          aria-label="Close"
          className={`min-h-[44px] min-w-[44px] [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0 inline-flex items-center justify-center text-slate-400 p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal transition-colors ${busy ? 'opacity-50 cursor-not-allowed' : 'hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#30363d]'}`}
        >
          <X size={20} />
        </button>
        <Tip text={busy ? 'Wait for the request to finish' : 'Close'} />
        {busy && <span id={closeReasonId} className="sr-only">Wait for the request to finish</span>}
        </span>
        </span>

        <div className="p-8">
            <div className="text-center mb-8">
              <img 
                src="/pixtaffy.png"
                alt="PixTaffy logo"
                className="w-16 h-16 object-contain drop-shadow-lg mx-auto mb-4"
              />
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {isLogin ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
              {isLogin
                ? 'Enter your details to access your brand kit.'
                : hasPendingImage
                  ? 'Save your image, then verify your email to receive 10 starter credits.'
                  : 'Create your account, then verify your email to receive 10 starter credits.'}
            </p>
          </div>

          <form noValidate onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p id={errorId} role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-300 text-sm text-center break-words font-medium animate-in fade-in">
                {error}
              </p>
            )}

            {status && (
              <div role="status" className="p-3 rounded-lg bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800/50 text-cyan-700 dark:text-cyan-200 text-sm text-center font-medium animate-in fade-in">
                {status}
              </div>
            )}

            {!isLogin && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider ml-1">Full name</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="text"
                      ref={(field) => { fieldRefs.current.name = field; }}
                      aria-invalid={Boolean(error && errorField === 'name')}
                      aria-describedby={error && errorField === 'name' ? errorId : undefined}
                      value={name}
                      onChange={(e) => { setName(e.target.value); if (errorField === 'name') { setError(null); setErrorField(null); } }}
                      className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-xl py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all"
                      placeholder="John Doe"
                      required={!isLogin}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider ml-1">Username</label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">@</div>
                    <input
                      type="text"
                      ref={(field) => { fieldRefs.current.username = field; }}
                      aria-invalid={Boolean(error && errorField === 'username')}
                      aria-describedby={error && errorField === 'username' ? errorId : undefined}
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); if (errorField === 'username') { setError(null); setErrorField(null); } }}
                      className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-xl py-3 pl-8 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all"
                      placeholder="johndoe"
                      required={!isLogin}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider ml-1">
                {isLogin ? "Email or username" : "Email address"}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type={isLogin ? "text" : "email"}
                  ref={(field) => { fieldRefs.current.email = field; }}
                  aria-invalid={Boolean(error && errorField === 'email')}
                  aria-describedby={error && errorField === 'email' ? errorId : undefined}
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (errorField === 'email') { setError(null); setErrorField(null); } }}
                  className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-xl py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all"
                  placeholder={isLogin ? "john@example.com or johndoe" : "john@example.com"}
                  required
                />
              </div>
              {isLogin && (
                <div className="flex justify-end">
                <span className="relative inline-flex ml-auto">
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  aria-disabled={resetDisabled}
                  aria-describedby={resetDisabled ? resetReasonId : undefined}
                  className={`min-h-[44px] min-w-[44px] [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0 inline-flex items-center justify-center text-xs font-semibold text-brand-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal ${resetDisabled ? 'cursor-not-allowed opacity-60' : 'hover:underline'}`}
                >
                  {isResetting ? 'Sending reset link…' : 'Forgot password?'}
                </button>
                <Tip text={resetTip} />
                {resetDisabled && <span id={resetReasonId} className="sr-only">{resetTip}</span>}
                </span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="password"
                  ref={(field) => { fieldRefs.current.password = field; }}
                  aria-invalid={Boolean(error && errorField === 'password')}
                  aria-describedby={error && errorField === 'password' ? errorId : undefined}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (errorField === 'password') { setError(null); setErrorField(null); } }}
                  className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-xl py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <span className="relative block w-full mt-6">
            <button
              type="submit"
              aria-disabled={submitDisabled}
              aria-describedby={submitDisabled ? submitReasonId : undefined}
              className={`w-full min-h-11 bg-brand-teal text-[#0d1117] text-sm font-bold py-3.5 rounded-lg shadow-lg shadow-brand-teal/20 flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#161b22] ${submitDisabled ? 'opacity-70 cursor-not-allowed' : 'hover:bg-teal-600 active:scale-[0.98]'}`}
            >
              {isLoading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <>
                  {isLogin ? 'Log in' : 'Create account'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
            <Tip text={submitTip} />
            {submitDisabled && <span id={submitReasonId} className="sr-only">{submitTip}</span>}
            </span>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button
                type="button"
                onClick={toggleMode}
                className="min-h-[44px] min-w-[44px] [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0 inline-flex items-center justify-center text-brand-teal font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
              >
                {isLogin ? 'Sign up' : 'Log in'}<Tip text={isLogin ? 'Sign up' : 'Log in'} />
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
