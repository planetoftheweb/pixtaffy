import React from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Download,
  Play,
  Sparkles,
  Zap,
} from 'lucide-react';
import { FeatureDemoGrid } from './FeatureDemoGrid';

interface LandingPageProps {
  isMember: boolean;
  onEnterStudio: () => void;
  onViewPricing: () => void;
  onLogin: () => void;
  onSignUp: () => void;
}

const steps = [
  {
    number: '01',
    title: 'Tell us what you need',
    copy: 'Write a prompt, drop in a reference, or upload brand guidelines. PixTaffy gathers the ingredients.',
  },
  {
    number: '02',
    title: 'Start with three guest credits',
    copy: 'Try GPT Image 2.5 before you register, then use the remaining credit on a Standard model. Your work stays in this browser, ready to download.',
  },
  {
    number: '03',
    title: 'Shape it into a system',
    copy: 'Create a free account to sync your work across browsers, refine versions, use AI helpers, and build the next frame.',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  isMember,
  onEnterStudio,
  onViewPricing,
  onLogin,
  onSignUp,
}) => {
  const primaryLabel = isMember ? 'Back to the studio' : 'Create your first image';

  return (
    <main className="min-w-0 overflow-hidden bg-brand-cream/45 text-slate-950 dark:bg-[#080d18] dark:text-white">
      <section className="relative isolate border-b border-orange-100 dark:border-white/10">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="absolute -left-36 top-24 h-96 w-96 rounded-full bg-brand-orange/25 blur-3xl" />
          <div className="absolute -right-24 -top-20 h-[30rem] w-[30rem] rounded-full bg-brand-pink/25 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-cyan/20 blur-3xl" />
          <div className="pixtaffy-grid pixtaffy-grid-fade absolute inset-0" />
        </div>

        <div className="mx-auto grid max-w-[1500px] items-center gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[0.88fr_1.12fr] lg:px-12 lg:py-24 xl:gap-16">
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-purple/25 bg-white/75 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-brand-purple shadow-sm backdrop-blur dark:border-brand-cyan/30 dark:bg-white/5 dark:text-brand-cyan">
              <Sparkles size={14} />
              Your brand&apos;s new creative crew
            </div>
            <h1 className="pixtaffy-display mt-6 text-balance text-4xl font-extrabold leading-[0.98] tracking-[-0.045em] sm:text-6xl sm:font-black lg:text-7xl">
              Turn one idea into a whole set of{' '}
              <span className="bg-gradient-to-r from-brand-orange via-brand-red to-brand-purple bg-clip-text text-transparent">
                <span className="whitespace-nowrap">on-brand</span> visuals.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-700 dark:text-slate-300 sm:text-xl">
              PixTaffy remembers your look, brings the best image models into one studio, and helps you stretch a single generation into the next image, slide, or video frame.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onEnterStudio}
                className="group inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-red via-brand-pink to-brand-purple px-6 py-3.5 text-base font-black leading-tight text-white shadow-xl shadow-brand-pink/25 transition hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-brand-pink/30 focus:outline-none focus:ring-4 focus:ring-brand-pink/25"
              >
                <Play size={18} fill="currentColor" />
                {primaryLabel}
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </button>
              <a
                href="#features"
                className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-slate-300/80 bg-white/70 px-6 py-3.5 text-base font-bold leading-tight text-slate-800 backdrop-blur transition hover:border-brand-cyan hover:text-brand-teal dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-brand-cyan dark:hover:text-brand-cyan"
              >
                Explore features
              </a>
              <button
                type="button"
                onClick={onViewPricing}
                className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-slate-300/80 bg-white/70 px-6 py-3.5 text-base font-bold leading-tight text-slate-800 backdrop-blur transition hover:border-brand-pink hover:text-brand-pink dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-brand-pink"
              >
                Pricing
              </button>
            </div>

            {!isMember && (
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5"><BadgeCheck size={15} className="text-brand-teal" /> No card</span>
                <span className="inline-flex items-center gap-1.5"><BadgeCheck size={15} className="text-brand-teal" /> No account for guest credits</span>
                <span className="inline-flex items-center gap-1.5"><Download size={15} className="text-brand-teal" /> Download it immediately</span>
              </div>
            )}
          </div>

          <div className="relative mx-auto w-full max-w-4xl lg:mx-0">
            <div className="absolute inset-x-[10%] bottom-[2%] h-[18%] rounded-[50%] bg-slate-950/25 blur-2xl dark:bg-black/60" />
            <div className="relative overflow-hidden rounded-[2rem] border-4 border-white/75 bg-[#10182b] shadow-2xl shadow-brand-purple/20 dark:border-white/10 sm:rounded-[2.75rem]">
              <img
                src="/brand/pixtaffy-creative-studio.png"
                alt="The PixTaffy candy crew making colorful artwork in their creative studio"
                className="aspect-video h-auto w-full object-cover"
              />
              <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-2xl border border-white/20 bg-[#0b1020]/78 px-4 py-3 text-white shadow-xl backdrop-blur-md sm:inset-x-6 sm:bottom-6 sm:px-5">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.17em] text-brand-cyan sm:text-xs">Creative crew at work</p>
                  <p className="truncate text-sm font-bold sm:text-base">Prompt. Generate. Refine. Build.</p>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-orange to-brand-pink shadow-lg">
                  <Zap size={19} fill="currentColor" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-b border-orange-100 bg-white/65 dark:border-white/10 dark:bg-white/[0.025]">
        <div className="pixtaffy-spectrum absolute inset-x-0 top-0 h-1" aria-hidden="true" />
        <div className="mx-auto grid max-w-[1500px] gap-px px-5 py-4 sm:grid-cols-3 sm:px-8 lg:px-12">
          {[
            ['A brand system', 'Colors, styles, presets, and art direction'],
            ['An image studio', 'Multiple models, comparisons, and refinements'],
            ['A motion workshop', 'Frames, video, slides, and PNG exports'],
          ].map(([title, copy], index) => (
            <div key={title} className={`px-2 py-4 sm:px-6 ${index > 0 ? 'border-t border-orange-100 dark:border-white/10 sm:border-l sm:border-t-0' : ''}`}>
              <p className="text-sm font-bold text-slate-950 dark:text-white">{title}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="relative isolate scroll-mt-24 px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="pixtaffy-grid absolute inset-0 opacity-55 [mask-image:linear-gradient(to_bottom,transparent,black_16%,black_84%,transparent)]" />
          <div className="absolute -left-40 top-24 h-80 w-80 rounded-full bg-brand-cyan/10 blur-3xl" />
          <div className="absolute -right-32 bottom-16 h-80 w-80 rounded-full bg-brand-pink/10 blur-3xl" />
        </div>
        <div className="mx-auto max-w-[1500px]">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple dark:text-brand-cyan">One playful studio, a lot less juggling</p>
            <h2 className="pixtaffy-display mt-4 text-balance text-3xl font-extrabold tracking-[-0.035em] sm:text-5xl sm:font-black">Your ideas stay loose. Your brand stays together.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-700 dark:text-slate-300">
              The great thing is you can explore without rebuilding the brief every time. PixTaffy keeps the creative decisions close while you try new directions.
            </p>
          </div>

          <FeatureDemoGrid className="mt-12" />
        </div>
      </section>

      <section className="relative border-y border-brand-purple/15 bg-[#10172a] px-5 py-20 text-white sm:px-8 lg:px-12 lg:py-28">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute left-[6%] top-0 h-64 w-64 rounded-full bg-brand-purple/30 blur-3xl" />
          <div className="absolute bottom-0 right-[4%] h-72 w-72 rounded-full bg-brand-orange/20 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-[1500px]">
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-cyan">From blank prompt to finished piece</p>
              <h2 className="pixtaffy-display mt-4 text-3xl font-extrabold tracking-[-0.035em] sm:text-5xl sm:font-black">Three steps. Plenty of room to play.</h2>
            </div>
            <p className="max-w-2xl text-lg leading-8 text-slate-300 lg:justify-self-end">
              Start with the simplest version of your idea. The studio gives you more control when you want it, but it never makes you fill out a creative brief just to see something happen.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {steps.map((step) => (
              <article key={step.number} className="rounded-3xl border border-white/10 bg-white/[0.055] p-6 backdrop-blur sm:p-7">
                <p className="pixtaffy-counter bg-gradient-to-r from-brand-cyan to-brand-pink bg-clip-text text-4xl font-black text-transparent">{step.number}</p>
                <h3 className="pixtaffy-display mt-6 text-xl font-bold">{step.title}</h3>
                <p className="mt-3 leading-7 text-slate-300">{step.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-[1500px] gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-red dark:text-brand-cyan">Try the whole idea before you commit</p>
            <h2 className="pixtaffy-display mt-4 text-balance text-3xl font-extrabold tracking-[-0.035em] sm:text-5xl sm:font-black">Three guest credits. No account required.</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-700 dark:text-slate-300">
              Start with GPT Image 2.5, then use the credit left over on a Standard model. Create an account and verify your email for 10 starter credits, or bring your own image-generation key and keep creating free.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Guest balance', value: '3 credits', copy: 'No signup required', color: 'from-brand-orange to-brand-red' },
              { label: 'Starter bag', value: '10 credits', copy: 'After email verification', color: 'from-brand-cyan to-brand-teal' },
              { label: 'Your own keys', value: 'Free BYOK', copy: 'You control provider usage', color: 'from-brand-pink to-brand-purple' },
            ].map((item) => (
              <div key={item.label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#111827]">
                <div className={`h-2 w-16 rounded-full bg-gradient-to-r ${item.color}`} />
                <p className="mt-5 text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{item.label}</p>
                <p className="pixtaffy-counter mt-2 text-2xl font-extrabold">{item.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:px-12 lg:pb-28">
        <div className="relative mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#ff711f] via-[#eb2d65] to-[#8d32df] px-6 py-10 text-white shadow-2xl shadow-brand-pink/20 sm:px-10 sm:py-12 lg:grid lg:grid-cols-[1fr_0.9fr] lg:items-center lg:px-14 lg:py-14">
          <div className="relative z-10 max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/75">The crew saved you a seat</p>
            <h2 className="pixtaffy-display mt-4 text-3xl font-extrabold tracking-[-0.035em] sm:text-5xl sm:font-black">Give PixTaffy one idea. Watch the crew get to work.</h2>
            <p className="mt-4 max-w-xl text-lg leading-8 text-white/85">
              Your three guest credits are ready and anything you make stays in this browser. Download it anytime, or create a free account to save it in the cloud and open it on your other devices.
            </p>
            <button
              type="button"
              onClick={onEnterStudio}
              className="group mt-7 inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-base font-black text-[#751c69] shadow-xl transition hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-white/35"
            >
              <Sparkles size={18} />
              {primaryLabel}
              <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
            </button>
            {!isMember && (
              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-white/80">
                <span>Already made something?</span>
                <button type="button" onClick={onLogin} className="font-black text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">Log in</button>
                <span aria-hidden="true">or</span>
                <button type="button" onClick={onSignUp} className="font-black text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">create an account</button>
              </div>
            )}
          </div>
          <img
            src="/brand/pixtaffy-taffy-crew.png"
            alt="Four smiling PixTaffy candy creatives"
            className="relative z-10 mx-auto mt-8 w-full max-w-2xl drop-shadow-[0_24px_28px_rgba(57,8,50,0.35)] lg:-mb-14 lg:mt-0 lg:scale-110"
          />
          <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-white/20 blur-3xl" aria-hidden="true" />
        </div>
      </section>
    </main>
  );
};
