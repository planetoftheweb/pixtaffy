import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Archive,
  Check,
  Coins,
  CreditCard,
  Film,
  Image,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import type { User } from '../types';
import { authService } from '../services/authService';
import {
  billingService,
  SITE_FUNDED_MODEL_MILLICREDITS,
  type BillingState,
  type CreditActivityEntry,
} from '../services/billingService';
import { FeatureDemoGrid } from './FeatureDemoGrid';

interface PricingPageProps {
  user: User;
  onBack: () => void;
}

const formatCredits = (milliCredits: number): string => {
  const credits = milliCredits / 1_000;
  return Number.isInteger(credits) ? String(credits) : credits.toFixed(1);
};

const [standardCreditCost, proCreditCost, premiumCreditCost] = [
  ...new Set(Object.values(SITE_FUNDED_MODEL_MILLICREDITS).map((milliCredits) => milliCredits / 1_000)),
].sort((a, b) => a - b);

const estimateImages = (credits: number) => ({
  standard: Math.floor(credits / standardCreditCost),
  pro: Math.floor(credits / proCreditCost),
  premium: Math.floor(credits / premiumCreditCost),
});

const products = [
  {
    id: 'credits_25' as const,
    name: 'Taffy Twist',
    eyebrow: '25-credit pack',
    price: '$6',
    note: '24 cents per credit',
    estimates: estimateImages(25),
    image: '/brand/pricing-taffy-illustrator.webp',
    imageAlt: 'An orange taffy illustrator drawing a colorful image on a tablet',
    accent: 'from-orange-400 via-brand-orange to-brand-red',
  },
  {
    id: 'credits_100' as const,
    name: 'Saltwater Taffy',
    eyebrow: '100-credit pack',
    price: '$18',
    note: '18 cents per credit',
    estimates: estimateImages(100),
    image: '/brand/pricing-taffy-art-director.webp',
    imageAlt: 'A saltwater taffy art director comparing three colorful image concepts',
    accent: 'from-brand-cyan via-brand-pink to-brand-purple',
    featured: true,
  },
  {
    id: 'credits_300' as const,
    name: 'Taffy Variety Box',
    eyebrow: '300-credit pack',
    price: '$45',
    note: '15 cents per credit',
    estimates: estimateImages(300),
    image: '/brand/pricing-taffy-photographer.webp',
    imageAlt: 'A yellow, coral, and purple taffy photographer creating a candy image',
    accent: 'from-brand-purple via-brand-pink to-brand-orange',
  },
];

const activityLabel = (entry: CreditActivityEntry): string => {
  const labels: Record<string, string> = {
    signup_grant: 'Starter credits',
    credit_purchase: 'Credit purchase',
    subscription_grant: 'Studio monthly credits',
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

const MascotWindow: React.FC<{ position: string; label: string; className?: string }> = ({
  position,
  label,
  className = '',
}) => (
  <div
    role="img"
    aria-label={label}
    className={'bg-no-repeat ' + className}
    style={{
      backgroundImage: "url('/brand/pixtaffy-taffy-crew.png')",
      backgroundSize: '400% auto',
      backgroundPosition: position + ' center',
    }}
  />
);

const Estimate: React.FC<{ value: number; label: string; color: string }> = ({ value, label, color }) => (
  <div className="rounded-xl bg-white/75 px-3 py-2 text-center ring-1 ring-black/5 dark:bg-white/5 dark:ring-white/10">
    <p className={'text-xl font-black ' + color}>{value}</p>
    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
  </div>
);

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
        setMessage('We sent a fresh verification link to ' + user.email + '.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not verify your email.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="flex-1 overflow-hidden bg-[#fff8ef] px-4 py-6 dark:bg-[#090d18] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <button onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-700 hover:text-brand-pink dark:text-slate-200">
            <ArrowLeft size={17} /> Back to studio
          </button>
          <button onClick={() => void load()} disabled={loading} className="rounded-xl p-3 text-slate-500 hover:bg-white hover:text-brand-pink dark:hover:bg-[#161b22]" aria-label="Refresh billing">
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/30 bg-[#11172a] px-6 pb-0 pt-7 text-white shadow-2xl shadow-brand-purple/15 sm:px-10 sm:pt-10">
          <div className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-brand-orange/40 blur-3xl" />
          <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-brand-pink/35 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-1/3 h-48 w-96 rounded-full bg-brand-cyan/25 blur-3xl" />
          <div className="relative grid items-center gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="pb-2 sm:pb-7">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-brand-cyan">
                <Coins size={14} /> PixTaffy credits
              </div>
              <h1 className="max-w-3xl text-4xl font-black leading-[0.98] tracking-tight sm:text-6xl">
                Pick the amount of <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-orange via-brand-pink to-brand-cyan">creative fuel</span> you need.
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Bring your own image key for free, buy credits that never expire, or join the Studio for a fresh monthly balance and a much bigger history.
              </p>
              <div className="mt-6 inline-flex items-center gap-4 rounded-2xl border border-white/10 bg-white/10 px-5 py-3 backdrop-blur">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Your balance</p>
                  <p className="mt-0.5 text-3xl font-black">{billing?.isAdmin ? 'Unlimited' : billing ? formatCredits(billing.balanceMilliCredits) : '...'}</p>
                </div>
                {!billing?.isAdmin && <span className="rounded-full bg-brand-orange px-2.5 py-1 text-xs font-black text-[#261307]">credits</span>}
              </div>
            </div>
            <img
              src="/brand/pixtaffy-taffy-crew.png"
              alt="The four taffy creatives behind PixTaffy"
              className="relative mx-auto -mb-1 w-full max-w-2xl drop-shadow-[0_22px_24px_rgba(0,0,0,0.3)]"
            />
          </div>
        </section>

        {message && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">{message}</div>}

        {!user.emailVerified && !billing?.starterGranted && (
          <section className="mt-6 flex flex-col justify-between gap-4 rounded-2xl border border-brand-cyan/30 bg-cyan-50 p-5 dark:bg-brand-cyan/10 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-black text-slate-950 dark:text-white">Your first 5 credits are waiting</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Verify {user.email} to get about 5 Standard, 2 Pro, or 1 Premium image. Starter credits last 30 days.</p>
            </div>
            <button onClick={() => void verify()} disabled={busy === 'verify'} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-pink px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-brand-pink/20 disabled:opacity-60">
              {busy === 'verify' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Check verification
            </button>
          </section>
        )}

        <section className="mt-10">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-pink">One-time credit packs</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Buy a bag. Use it whenever you want.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Every pack opens the same PixTaffy-funded models and AI tools. A bigger pack gives you more credits and a lower price per credit. All packs keep up to 500 cloud-saved generation entries.
            </p>
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            {products.map((product) => (
              <article key={product.id} className={'relative overflow-hidden rounded-3xl border bg-white shadow-lg transition-transform hover:-translate-y-1 dark:bg-[#141a29] ' + (product.featured ? 'border-brand-cyan ring-2 ring-brand-cyan/30' : 'border-slate-200 dark:border-white/10')}>
                <div className={'h-2 bg-gradient-to-r ' + product.accent} />
                <div className="relative h-48 overflow-hidden bg-gradient-to-br from-[#fff0dd] via-[#ffe5f3] to-[#dffbff] dark:from-white/10 dark:via-brand-pink/10 dark:to-brand-cyan/10 sm:h-52">
                  <img src={product.image} alt={product.imageAlt} loading="lazy" className="h-full w-full object-cover object-center" />
                  {product.featured && <span className="absolute right-4 top-4 rounded-full bg-[#11172a] px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-brand-cyan">Most popular</span>}
                </div>
                <div className="p-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-purple dark:text-brand-cyan">{product.eyebrow}</p>
                  <h3 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{product.name}</h3>
                  <div className="mt-4 flex items-end gap-3">
                    <p className="text-5xl font-black text-slate-950 dark:text-white">{product.price}</p>
                    <p className="pb-1 text-xs font-semibold text-slate-500">{product.note}</p>
                  </div>
                  <p className="mt-5 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">About this many images</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Estimate value={product.estimates.standard} label="Standard" color="text-brand-teal" />
                    <Estimate value={product.estimates.pro} label="Pro" color="text-brand-purple" />
                    <Estimate value={product.estimates.premium} label="Premium" color="text-brand-pink" />
                  </div>
                  <ul className="mt-5 space-y-2.5 text-sm text-slate-700 dark:text-slate-200">
                    <li className="flex gap-2"><Check size={17} className="mt-0.5 shrink-0 text-brand-teal" /> Credits never expire</li>
                    <li className="flex gap-2"><Archive size={17} className="mt-0.5 shrink-0 text-brand-orange" /> 500 cloud-saved generation entries</li>
                    <li className="flex gap-2"><WandSparkles size={17} className="mt-0.5 shrink-0 text-brand-pink" /> Images, analysis, naming, and prompt tools</li>
                  </ul>
                  <button onClick={() => void checkout(product.id)} disabled={busy != null} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#11172a] px-4 py-3 text-sm font-black text-white shadow-lg transition-colors hover:bg-brand-pink disabled:opacity-60 dark:bg-white dark:text-[#11172a] dark:hover:bg-brand-cyan">
                    {busy === product.id ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />} Get {product.eyebrow.replace('-credit pack', '')} credits
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="relative mt-8 overflow-hidden rounded-[2rem] border border-brand-purple/30 bg-gradient-to-br from-[#2c1145] via-[#1a183f] to-[#0a3444] p-6 text-white shadow-xl sm:p-8">
          <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full bg-brand-pink/30 blur-3xl" />
          <div className="relative grid items-center gap-6 lg:grid-cols-[180px_1fr_260px]">
            <MascotWindow position="93%" label="Taffy Studio director character" className="mx-auto h-48 w-44 shrink-0" />
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-cyan">Monthly membership</p>
              <h2 className="mt-1 text-3xl font-black sm:text-4xl">Taffy Studio</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Get 100 credits every month, enough for about 100 Standard, 50 Pro, or 33 Premium images. Unused subscription credits can roll over to a 200-credit balance.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/10 p-3"><p className="text-2xl font-black text-brand-cyan">2,000</p><p className="text-xs text-slate-300">cloud-saved generations</p></div>
                <div className="rounded-xl bg-white/10 p-3"><p className="text-2xl font-black text-brand-orange">100</p><p className="text-xs text-slate-300">credits each month</p></div>
                <div className="rounded-xl bg-white/10 p-3"><p className="text-2xl font-black text-brand-pink">200</p><p className="text-xs text-slate-300">maximum rollover</p></div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5 backdrop-blur">
              <p className="text-4xl font-black">$15<span className="text-base font-semibold text-slate-400">/month</span></p>
              <p className="mt-2 text-xs leading-5 text-slate-300">All credit-powered image models and AI helpers are included. They spend from your monthly balance at the published rates.</p>
              <button onClick={() => void checkout('pro_monthly')} disabled={busy != null || billing?.plan === 'pro'} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-purple via-brand-pink to-brand-red px-4 py-3 text-sm font-black text-white shadow-lg disabled:opacity-60">
                {busy === 'pro_monthly' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {billing?.plan === 'pro' ? 'Current plan' : 'Join Taffy Studio'}
              </button>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-cyan">What the studio can do</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">See what your credits and keys actually power.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">These are the creative jobs PixTaffy keeps together, from the first brand board through model comparison, AI assistance, animation frames, and version history.</p>
          </div>
          <FeatureDemoGrid className="mt-6" />
        </section>

        <section className="mt-10 grid gap-5 lg:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-[#141a29] sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-100 text-brand-teal dark:bg-brand-cyan/10 dark:text-brand-cyan"><Image size={21} /></span>
              <div><p className="text-xs font-black uppercase tracking-wider text-brand-teal">Image generation</p><h2 className="text-2xl font-black text-slate-950 dark:text-white">How far credits go</h2></div>
            </div>
            <div className="mt-5 space-y-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="flex items-start justify-between gap-5 rounded-xl bg-slate-50 p-4 dark:bg-white/5"><div><p className="font-black">Standard image</p><p className="mt-1 text-xs text-slate-500">Seedream, Grok, and other models in the Standard band</p></div><span className="shrink-0 rounded-full bg-cyan-100 px-3 py-1 text-xs font-black text-brand-teal dark:bg-brand-cyan/10 dark:text-brand-cyan">1 credit</span></div>
              <div className="flex items-start justify-between gap-5 rounded-xl bg-slate-50 p-4 dark:bg-white/5"><div><p className="font-black">Pro image</p><p className="mt-1 text-xs text-slate-500">FLUX.2 Pro, GPT Image 2, and PixTaffy Gemini models</p></div><span className="shrink-0 rounded-full bg-purple-100 px-3 py-1 text-xs font-black text-brand-purple dark:bg-brand-purple/15 dark:text-purple-200">2 credits</span></div>
              <div className="flex items-start justify-between gap-5 rounded-xl bg-slate-50 p-4 dark:bg-white/5"><div><p className="font-black">Premium image</p><p className="mt-1 text-xs text-slate-500">Recraft V4.1 Pro and models in the Premium band</p></div><span className="shrink-0 rounded-full bg-pink-100 px-3 py-1 text-xs font-black text-brand-pink dark:bg-brand-pink/15 dark:text-pink-200">3 credits</span></div>
            </div>
            <p className="mt-4 flex gap-2 text-xs leading-5 text-slate-500 dark:text-slate-400"><Info size={15} className="mt-0.5 shrink-0" /> Estimates assume every credit is spent on images. Using AI helpers or mixing model bands changes the total. PixTaffy always shows the final cost before generation.</p>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-[#141a29] sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-100 text-brand-pink dark:bg-brand-pink/10"><Film size={21} /></span>
              <div><p className="text-xs font-black uppercase tracking-wider text-brand-pink">Build Studio</p><h2 className="text-2xl font-black text-slate-950 dark:text-white">Video frames and exports</h2></div>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-slate-700 dark:text-slate-200">
              <li className="flex gap-3 rounded-xl bg-slate-50 p-4 dark:bg-white/5"><Check size={18} className="mt-0.5 shrink-0 text-brand-teal" /><div><p className="font-black">Manual frames are free</p><p className="mt-1 text-xs leading-5 text-slate-500">Draw, reorder, preview, and animate as many frames as you need without spending credits.</p></div></li>
              <li className="flex gap-3 rounded-xl bg-slate-50 p-4 dark:bg-white/5"><Check size={18} className="mt-0.5 shrink-0 text-brand-orange" /><div><p className="font-black">Exports are free</p><p className="mt-1 text-xs leading-5 text-slate-500">MP4 video, PowerPoint, and PNG sequence exports render locally in your browser.</p></div></li>
              <li className="flex gap-3 rounded-xl bg-slate-50 p-4 dark:bg-white/5"><WandSparkles size={18} className="mt-0.5 shrink-0 text-brand-purple" /><div><p className="font-black">Optional AI assists use tiny amounts</p><p className="mt-1 text-xs leading-5 text-slate-500">AI frame detection costs 0.2 credit. AI frame naming costs 0.1 credit.</p></div></li>
            </ul>
          </article>
        </section>

        <section className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-[#141a29] sm:p-8">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-orange">Save limits, spelled out</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Guests stay local. Accounts sync across browsers.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Your free first image stays in this browser until you register. A free account syncs the latest 100 generation entries. Any credit pack raises that cloud history to 500, and Taffy Studio raises it to 2,000 while active.</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { name: 'Guest first image', value: 'Local', detail: 'kept only in this browser until you register', color: 'text-brand-orange', bg: 'from-orange-50 to-white dark:from-brand-orange/10 dark:to-white/5' },
              { name: 'Free account', value: '100', detail: 'latest cloud-saved entries across browsers', color: 'text-brand-teal', bg: 'from-cyan-50 to-white dark:from-brand-cyan/10 dark:to-white/5' },
              { name: 'Any credit pack', value: '500', detail: 'cloud-saved generation entries', color: 'text-brand-purple', bg: 'from-purple-50 to-white dark:from-brand-purple/10 dark:to-white/5' },
              { name: 'Taffy Studio', value: '2,000', detail: 'cloud-saved entries while active', color: 'text-brand-pink', bg: 'from-pink-50 to-white dark:from-brand-pink/10 dark:to-white/5' },
            ].map((tier) => (
              <div key={tier.name} className={'rounded-2xl border border-slate-200 bg-gradient-to-br p-5 dark:border-white/10 ' + tier.bg}>
                <p className="text-sm font-black text-slate-950 dark:text-white">{tier.name}</p>
                <p className={'mt-3 text-4xl font-black ' + tier.color}>{tier.value}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tier.detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 dark:bg-amber-400/10 dark:text-amber-100"><Archive size={16} className="mt-0.5 shrink-0" /> Guest work uses local browser storage and can disappear if site data is cleared. Registration is free and moves the guest image into cloud history, so credits are not required just to save. A batch entry can contain several images or versions.</p>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-[#141a29]">
            <div className="flex items-center gap-2"><KeyRound size={19} className="text-brand-cyan" /><h2 className="font-black text-slate-950 dark:text-white">Free BYOK stays free</h2></div>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Use your own Gemini, OpenAI, or OpenRouter key for image generation without PixTaffy credits. Your provider bills you directly. PixTaffy AI helpers use 0.1 to 0.5 credit because those requests run through PixTaffy.</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-[#141a29]">
            <div className="flex items-center gap-2"><Sparkles size={19} className="text-brand-pink" /><h2 className="font-black text-slate-950 dark:text-white">AI helper prices</h2></div>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Prompt expansion and AI naming cost 0.1 credit. Image analysis, corrections, style extraction, and frame detection cost 0.2. PDF brand-guideline analysis costs 0.5.</p>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-[#141a29]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-black text-slate-950 dark:text-white">Recent credit activity</h2>
            {billing?.stripeCustomerId && <button onClick={() => void billingService.openCustomerPortal()} className="text-sm font-bold text-brand-pink hover:underline">Manage billing</button>}
          </div>
          {loading ? <Loader2 className="mx-auto my-8 animate-spin text-brand-pink" /> : activity.length === 0 ? <p className="mt-4 text-sm text-slate-500">No credit activity yet.</p> : (
            <div className="mt-4 divide-y divide-slate-100 dark:divide-white/10">
              {activity.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <div><p className="font-semibold capitalize text-slate-800 dark:text-slate-200">{activityLabel(entry)}</p><p className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</p></div>
                  <span className={'font-black ' + (entry.deltaMilliCredits >= 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200')}>{entry.deltaMilliCredits >= 0 ? '+' : ''}{formatCredits(entry.deltaMilliCredits)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};
