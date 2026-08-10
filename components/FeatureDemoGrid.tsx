import React from 'react';
import {
  Clapperboard,
  Images,
  KeyRound,
  Layers3,
  Palette,
  WandSparkles,
} from 'lucide-react';

const featureDemos = [
  {
    icon: Palette,
    accent: 'text-brand-pink',
    wash: 'from-brand-pink/15 to-brand-purple/5',
    image: '/brand/feature-brand-system.webp',
    imageAlt: 'A taffy creative arranging colors, styles, and image samples on a brand board',
    title: 'Keep your brand in the room',
    copy: 'Save colors, styles, graphic types, and art direction so every new image starts with the same creative brief.',
  },
  {
    icon: Images,
    accent: 'text-brand-cyan',
    wash: 'from-brand-cyan/15 to-brand-teal/5',
    image: '/brand/feature-model-compare.webp',
    imageAlt: 'A taffy creative comparing the same image rendered in three different styles',
    title: 'Compare the best image models',
    copy: 'Run one prompt through multiple models, compare the results side by side, and keep the version that earns its spot.',
  },
  {
    icon: WandSparkles,
    accent: 'text-brand-orange',
    wash: 'from-brand-orange/15 to-brand-red/5',
    image: '/brand/feature-ai-assist.webp',
    imageAlt: 'A taffy assistant analyzing an image with color, crop, and prompt tools',
    title: 'Get help where it matters',
    copy: 'Expand prompts, analyze references, extract styles, name assets, and make corrections without leaving the workspace.',
  },
  {
    icon: Clapperboard,
    accent: 'text-brand-purple',
    wash: 'from-brand-purple/15 to-brand-pink/5',
    image: '/brand/feature-build-studio.webp',
    imageAlt: 'A taffy filmmaker arranging four sequential animation frames on a timeline',
    title: 'Turn a still into a story',
    copy: 'Build animation frames from your artwork, preview the sequence, then export video, PowerPoint, or individual PNG files.',
  },
  {
    icon: Layers3,
    accent: 'text-brand-red',
    wash: 'from-brand-red/15 to-brand-orange/5',
    image: '/brand/feature-version-history.webp',
    imageAlt: 'A taffy archivist organizing image versions into colorful folders',
    title: 'Keep every good version',
    copy: 'Your generations, refinements, presets, and folders stay together, ready when a campaign comes back around.',
  },
  {
    icon: KeyRound,
    accent: 'text-brand-teal',
    wash: 'from-brand-teal/15 to-brand-cyan/5',
    image: '/brand/feature-flexible-billing.webp',
    imageAlt: 'Two taffy creatives generating the same image with a key or PixTaffy credits',
    title: 'Choose how you pay',
    copy: 'Bring your own image-generation key for free, or use PixTaffy credits when you want us to handle the provider bill.',
  },
];

interface FeatureDemoGridProps {
  className?: string;
}

export const FeatureDemoGrid: React.FC<FeatureDemoGridProps> = ({ className = '' }) => (
  <div className={`grid gap-5 md:grid-cols-2 xl:grid-cols-3 ${className}`}>
    {featureDemos.map((feature) => {
      const Icon = feature.icon;
      return (
        <article
          key={feature.title}
          className="group flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-white/10 dark:bg-[#111827]"
        >
          <div className="relative aspect-[4/3] shrink-0 overflow-hidden bg-[#10172a]">
            <img
              src={feature.image}
              alt={feature.imageAlt}
              loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#080d18]/75 to-transparent" />
            <div className="absolute bottom-4 left-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/25 bg-[#080d18]/75 shadow-lg backdrop-blur">
              <Icon size={21} className={feature.accent} />
            </div>
          </div>
          <div className="relative flex-1 p-6 sm:p-7">
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${feature.wash}`} />
            <div className="relative">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Feature demo</p>
              <h3 className="mt-2 text-xl font-black tracking-tight text-slate-950 dark:text-white">{feature.title}</h3>
              <p className="mt-3 leading-7 text-slate-700 dark:text-slate-300">{feature.copy}</p>
            </div>
          </div>
        </article>
      );
    })}
  </div>
);
