import React from 'react';
import { Tip } from './settings/Tip';
import { navigate } from '../utils/routes';

const contact = <a href="mailto:privacy@pixelprowess.com" className="inline-flex min-h-[44px] min-w-[44px] [@media(pointer:fine)]:min-w-0 items-center break-words text-brand-teal underline [@media(pointer:fine)]:min-h-0">privacy@pixelprowess.com<Tip text="Contact Pixel Prowess" /></a>;
const privacySections = [
  ['Accounts', 'Firebase Authentication manages email and password accounts and sends verification emails. We collect your name, username and email address to identify your account.'],
  ['Saved work and browser storage', 'We save generation history, prompts, presets and settings in Cloud Firestore, and generated images in Firebase Storage. Your browser also keeps an IndexedDB image cache and localStorage preferences. Clearing site data removes those local copies.'],
  ['Image providers and API keys', 'Prompts and reference images are sent to the providers you pick: Google Gemini, OpenAI, OpenRouter and Recraft. Their terms and privacy policies apply to their processing. Your own API keys are stored server side and used only for your requests.'],
  ['Guest limits and protection', 'We use a guest install ID and hashed IP address to enforce daily guest credit limits. Firebase App Check with reCAPTCHA Enterprise protects the service from abuse.'],
  ['Payments', 'Stripe handles checkout and payment card data. PixTaffy keeps your Stripe customer ID, purchases and credit balance to provide paid features.'],
  ['Analytics', 'PixTaffy uses Firebase Analytics (Google Analytics) to measure site usage.'],
  ['Public feedback', 'Feedback notes, optional screenshots and optional contact email become a public GitHub issue. Do not include private information in feedback.'],
];
const termsSections = [
  ['Accounts', 'Keep your password and API keys private. Use accurate account information and only accounts and content you have permission to use. You are responsible for requests you authorize and charges from your own model providers.'],
  ['Credits and Studio plan', 'Credits are prepaid and used per generation. Credit packs and the Studio plan are sold as described on the pricing page and at checkout. Stripe handles payments. Manage refunds and cancellation through the Stripe billing portal; contact us for refund requests or billing problems. These terms do not remove rights provided by law.'],
  ['Acceptable use', 'Do not submit unlawful material, violate privacy or intellectual property rights, harass others, attack the service, bypass payment or guest limits, or access another person\'s work without permission. Access may be limited to address misuse.'],
  ['Your content and model providers', 'You own your prompts and outputs to the extent permitted by law, subject to the selected provider\'s terms. You permit PixTaffy and its providers to process content to deliver the features you request. Review outputs before use: AI may produce mistakes, similar results or material subject to other people\'s rights.'],
  ['No warranty', 'PixTaffy is provided as is and as available. To the extent permitted by law, we make no warranties about availability, accuracy, suitability or results.'],
  ['Limitation of liability', 'To the extent permitted by law, Pixel Prowess is not liable for indirect, incidental or consequential losses, including lost work, profits or service interruptions. Nothing here excludes liability or rights that cannot lawfully be excluded.'],
  ['Changes and governing law', 'Features and these terms may change. Updated terms will appear on this page with a revised date. Florida law governs these terms, subject to any mandatory protections that apply where you live.'],
];

export const LegalPage: React.FC<{ kind: 'privacy' | 'terms'; onBack: () => void }> = ({ kind, onBack }) => (
  <main className="flex-1 px-5 py-10 sm:px-8">
    <article className="mx-auto max-w-lg text-base leading-relaxed text-slate-800 dark:text-slate-100">
      <a href="/" onClick={event => { event.preventDefault(); onBack(); }} className="inline-flex min-h-[44px] min-w-[44px] items-center text-brand-teal underline [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0">Back to studio<Tip text="Back to studio" /></a>
      <h1 className="mt-6 text-2xl font-bold">{kind === 'privacy' ? 'Privacy policy' : 'Terms of service'}</h1>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Last updated October 27, 2026</p>
      <p className="mt-6">PixTaffy is operated by Eric (Ray) Villalobos, doing business as Pixel Prowess, a Florida sole proprietorship.</p>
      {(kind === 'privacy' ? privacySections : termsSections).map(([title, text]) => (
        <section key={title} className="mt-8">
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-2">{text}</p>
          {title === 'Credits and Studio plan' && <a href="/pricing" onClick={event => { event.preventDefault(); navigate('/pricing'); }} className="inline-flex min-h-[44px] min-w-[44px] [@media(pointer:fine)]:min-w-0 items-center text-brand-teal underline [@media(pointer:fine)]:min-h-0">View pricing<Tip text="View pricing" /></a>}
        </section>
      ))}
      <section className="mt-8"><h2 className="text-lg font-bold">Contact</h2><p className="mt-2">For privacy, account or billing questions, or requests to access, correct or delete your data, contact {contact}.</p></section>
    </article>
  </main>
);
