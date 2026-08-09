import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Coins, CreditCard, KeyRound, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { User } from '../types';
import { authService } from '../services/authService';
import { billingService, type BillingState, type CreditActivityEntry } from '../services/billingService';

interface PricingPageProps {
  user: User;
  onBack: () => void;
}

const formatCredits = (milliCredits: number): string => {
  const credits = milliCredits / 1_000;
  return Number.isInteger(credits) ? String(credits) : credits.toFixed(1);
};

const products = [
  { id: 'credits_25' as const, title: '25 credits', price: '$6', note: '24 cents per credit' },
  { id: 'credits_100' as const, title: '100 credits', price: '$18', note: '18 cents per credit', featured: true },
  { id: 'credits_300' as const, title: '300 credits', price: '$45', note: '15 cents per credit' },
];

const activityLabel = (entry: CreditActivityEntry): string => {
  const labels: Record<string, string> = {
    signup_grant: 'Starter credits',
    credit_purchase: 'Credit purchase',
    subscription_grant: 'Pro monthly credits',
    image_generation: 'Image generation',
    expand_prompt: 'Prompt expansion',
    ai_name: 'AI naming',
    image_analysis: 'Image analysis',
    correction_analysis: 'Correction analysis',
    style_extraction: 'Style extraction',
    region_detection: 'Region detection',
    image_description: 'Image description',
    brand_guidelines_image: 'Brand analysis',
    brand_guidelines_pdf: 'PDF brand analysis',
  };
  return labels[entry.reason] ?? entry.reason.replaceAll('_', ' ');
};

export const PricingPage: React.FC<PricingPageProps> = ({ user, onBack }) => {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [activity, setActivity] = useState<CreditActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [state, entries] = await Promise.all([
        billingService.getBillingState(true),
        billingService.getCreditActivity(),
      ]);
      setBilling(state);
      setActivity(entries);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load billing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const checkout = async (productId: 'credits_25' | 'credits_100' | 'credits_300' | 'pro_monthly') => {
    setBusy(productId);
    setMessage(null);
    try {
      await billingService.startCheckout(productId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Checkout could not start.');
      setBusy(null);
    }
  };

  const verify = async () => {
    setBusy('verify');
    setMessage(null);
    try {
      const verified = await authService.refreshEmailVerification();
      if (verified) {
        await load();
        setMessage('Email verified. Your 5 starter credits are ready.');
      } else {
        await authService.resendVerification();
        setMessage(`We sent a fresh verification link to ${user.email}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not verify your email.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="flex-1 bg-slate-50 dark:bg-[#0d1117] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-teal dark:text-slate-300">
            <ArrowLeft size={17} /> Back to studio
          </button>
          <button onClick={() => void load()} disabled={loading} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-brand-teal dark:hover:bg-[#161b22]" aria-label="Refresh billing">
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-fuchsia-600 via-brand-red to-orange-500 p-7 text-white shadow-xl sm:p-10">
          <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider"><Coins size={13} /> PixTaffy credits</div>
              <h1 className="text-3xl font-black tracking-tight sm:text-5xl">Make the good stuff. Pay for what you use.</h1>
              <p className="mt-3 max-w-2xl text-sm text-white/85 sm:text-base">Bring your own key for free image generation, or let PixTaffy handle the providers. AI workflow tools use tiny fractional credits.</p>
            </div>
            <div className="min-w-48 rounded-2xl bg-black/20 p-5 backdrop-blur-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-white/70">Available balance</p>
              <p className="mt-1 text-4xl font-black">{billing?.isAdmin ? 'Unlimited' : billing ? formatCredits(billing.balanceMilliCredits) : '...'}</p>
              {!billing?.isAdmin && <p className="text-sm text-white/70">credits</p>}
            </div>
          </div>
        </section>

        {message && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">{message}</div>}

        {!user.emailVerified && !billing?.starterGranted && (
          <section className="mt-6 flex flex-col justify-between gap-4 rounded-2xl border border-teal-200 bg-teal-50 p-5 dark:border-teal-900/60 dark:bg-teal-900/20 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">Your first 5 credits are waiting</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Verify {user.email} to receive 5 credits. They stay available for 30 days after they are granted.</p>
            </div>
            <button onClick={() => void verify()} disabled={busy === 'verify'} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              {busy === 'verify' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Check verification
            </button>
          </section>
        )}

        <div className="mt-8 grid gap-5 lg:grid-cols-4">
          {products.map((product) => (
            <article key={product.id} className={`relative rounded-2xl border bg-white p-6 shadow-sm dark:bg-[#161b22] ${product.featured ? 'border-brand-teal ring-2 ring-brand-teal/20' : 'border-slate-200 dark:border-[#30363d]'}`}>
              {product.featured && <span className="absolute right-4 top-4 rounded-full bg-teal-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">Popular</span>}
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{product.title}</h2>
              <p className="mt-4 text-4xl font-black text-slate-900 dark:text-white">{product.price}</p>
              <p className="mt-1 text-xs text-slate-500">{product.note}</p>
              <ul className="mt-5 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <li className="flex gap-2"><Check size={16} className="mt-0.5 text-brand-teal" /> Never expires</li>
                <li className="flex gap-2"><Check size={16} className="mt-0.5 text-brand-teal" /> 500 saved generations</li>
              </ul>
              <button onClick={() => void checkout(product.id)} disabled={busy != null} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-brand-red disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-brand-orange">
                {busy === product.id ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />} Buy credits
              </button>
            </article>
          ))}

          <article className="rounded-2xl border border-fuchsia-300 bg-white p-6 shadow-sm ring-2 ring-fuchsia-500/15 dark:border-fuchsia-900 dark:bg-[#161b22]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">PixTaffy Pro</h2>
            <p className="mt-4 text-4xl font-black text-slate-900 dark:text-white">$15<span className="text-base font-semibold text-slate-500">/month</span></p>
            <p className="mt-1 text-xs text-slate-500">100 credits every month</p>
            <ul className="mt-5 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex gap-2"><Check size={16} className="mt-0.5 text-fuchsia-500" /> Roll over up to 200 credits</li>
              <li className="flex gap-2"><Check size={16} className="mt-0.5 text-fuchsia-500" /> 2,000 saved generations</li>
              <li className="flex gap-2"><Check size={16} className="mt-0.5 text-fuchsia-500" /> All PixTaffy AI tools</li>
            </ul>
            <button onClick={() => void checkout('pro_monthly')} disabled={busy != null || billing?.plan === 'pro'} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-brand-red px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
              {busy === 'pro_monthly' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {billing?.plan === 'pro' ? 'Current plan' : 'Start Pro'}
            </button>
          </article>
        </div>

        <section className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-[#30363d] dark:bg-[#161b22]">
            <div className="flex items-center gap-2"><KeyRound size={18} className="text-brand-teal" /><h2 className="font-bold text-slate-900 dark:text-white">Free BYOK stays free</h2></div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your own Gemini, OpenAI, or OpenRouter key still works for image generation without PixTaffy credits. Prompt expansion, analysis, and other PixTaffy AI workflow tools use 0.1 to 0.5 credit.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-[#30363d] dark:bg-[#161b22]">
            <h2 className="font-bold text-slate-900 dark:text-white">Image prices</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Standard models cost 1 credit, Pro models cost 2, and Premium models cost 3. PixTaffy shows the price before a paid generation runs.</p>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900 dark:text-white">Recent credit activity</h2>{billing?.stripeCustomerId && <button onClick={() => void billingService.openCustomerPortal()} className="text-sm font-semibold text-brand-teal hover:underline">Manage subscription</button>}</div>
          {loading ? <Loader2 className="mx-auto my-8 animate-spin text-brand-teal" /> : activity.length === 0 ? <p className="mt-4 text-sm text-slate-500">No credit activity yet.</p> : (
            <div className="mt-4 divide-y divide-slate-100 dark:divide-[#30363d]">
              {activity.map((entry) => <div key={entry.id} className="flex items-center justify-between py-3 text-sm"><div><p className="font-medium capitalize text-slate-800 dark:text-slate-200">{activityLabel(entry)}</p><p className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</p></div><span className={`font-bold ${entry.deltaMilliCredits >= 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}`}>{entry.deltaMilliCredits >= 0 ? '+' : ''}{formatCredits(entry.deltaMilliCredits)}</span></div>)}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};
