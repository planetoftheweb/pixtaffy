import React, { useRef, useState } from 'react';
import { X, Mail, Lock, User as UserIcon, Loader2, ArrowRight, Layers } from 'lucide-react';
import { Tip } from './settings/Tip';
import { authService } from '../services/authService';
import { User } from '../types';

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
  const [status, setStatus] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const busyRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

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

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setError(null);
    setStatus(null);
    setIsLoading(true);

    try {
      let user: User;
      if (isLogin) {
        user = await authService.login(email, password);
      } else {
        if (!name) throw new Error("Name is required");
        if (!username) throw new Error("Username is required");
        user = await authService.register(name, email, password, username);
      }
      onLoginSuccess(user);
      onClose();
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      isSubmittingRef.current = false;
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (isResetting || isLoading) return;
    if (!email.trim()) {
      setError('Enter your email or username first.');
      setStatus(null);
      return;
    }

    setError(null);
    setStatus(null);
    setIsResetting(true);
    try {
      await authService.requestPasswordReset(email);
      setStatus('Check your email for a password reset link.');
    } catch (err: any) {
      setError(err.message || 'Could not send the password reset email.');
    } finally {
      setIsResetting(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError(null);
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
        
        <button
          type="button"
          onClick={() => { if (!busyRef.current) onClose(); }}
          aria-label="Close"
          className="min-h-[44px] min-w-[44px] [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0 inline-flex items-center justify-center absolute top-4 right-4 text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal hover:bg-gray-100 dark:hover:bg-[#30363d] transition-colors z-10"
        >
          <X size={20} /><Tip text="Close" />
        </button>

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

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-300 text-sm text-center font-medium animate-in fade-in">
                {error}
              </div>
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
                      value={name}
                      onChange={(e) => setName(e.target.value)}
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
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-xl py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all"
                  placeholder={isLogin ? "john@example.com or johndoe" : "john@example.com"}
                  required
                />
              </div>
              {isLogin && (
                <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={isResetting || isLoading}
                  className="min-h-[44px] min-w-[44px] [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0 inline-flex items-center justify-center ml-auto text-xs font-semibold text-brand-teal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isResetting ? 'Sending reset link…' : 'Forgot password?'}<Tip text="Forgot password?" />
                </button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-xl py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || isResetting}
              className="w-full min-h-11 bg-brand-teal hover:bg-teal-600 text-[#0d1117] text-sm font-bold py-3.5 rounded-lg shadow-lg shadow-brand-teal/20 flex items-center justify-center gap-2 transition-all mt-6 disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#161b22]"
            >
              {isLoading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <>
                  {isLogin ? 'Log in' : 'Create account'}<Tip text={isLogin ? 'Log in' : 'Create account'} />
                  <ArrowRight size={18} />
                </>
              )}
            </button>
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
