import React, { useEffect, useRef, useState } from 'react';
import { Bug, ExternalLink, ImagePlus, Lightbulb, MessageCircleQuestion, Send, X } from 'lucide-react';
import type { User } from '../types';
import {
  feedbackErrorMessage,
  makeFeedbackRequestId,
  submitFeedback,
  type FeedbackCategory,
} from '../services/feedbackService';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}

const CATEGORIES: Array<{
  value: FeedbackCategory;
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { value: 'bug', label: 'Bug', hint: 'Something broke or got in the way.', icon: Bug },
  { value: 'idea', label: 'Idea', hint: 'A feature or improvement you want.', icon: Lightbulb },
  { value: 'question', label: 'Question', hint: 'Something needs a better explanation.', icon: MessageCircleQuestion },
  { value: 'other', label: 'Other', hint: 'Anything else you want us to know.', icon: Send },
];

const DRAFT_KEY = 'pixtaffy_feedback_draft_v1';

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, user }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const requestIdRef = useRef(makeFeedbackRequestId());
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [message, setMessage] = useState('');
  const [contactEmail, setContactEmail] = useState(user?.email || '');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState<{ url: string; number: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') as {
        category?: FeedbackCategory;
        message?: string;
        contactEmail?: string;
      };
      if (CATEGORIES.some((item) => item.value === draft.category)) setCategory(draft.category!);
      if (typeof draft.message === 'string') setMessage(draft.message);
      setContactEmail(typeof draft.contactEmail === 'string' ? draft.contactEmail : user?.email || '');
    } catch {
      setContactEmail(user?.email || '');
    }
  }, [isOpen, user?.email]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 120);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || issue) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ category, message, contactEmail }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [category, contactEmail, isOpen, issue, message]);

  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  if (!isOpen) return null;

  const acceptScreenshot = (file?: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Choose a PNG, JPEG, WebP, or GIF screenshot.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Keep screenshots under 5 MB.');
      return;
    }
    setError(null);
    setScreenshot(file);
  };

  const sendFeedback = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (message.trim().length < 3) {
      setError('Write a short note so we know what to look at.');
      return;
    }
    setBusy(true);
    try {
      const result = await submitFeedback({
        category,
        message,
        contactEmail,
        screenshot,
        idempotencyKey: requestIdRef.current,
      });
      localStorage.removeItem(DRAFT_KEY);
      setIssue({ url: result.issueUrl, number: result.issueNumber });
      setScreenshot(null);
    } catch (submitError) {
      setError(feedbackErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-2 sm:p-6 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="relative w-full max-w-2xl max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#30363d] dark:bg-[#0d1117] sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-[#30363d] dark:bg-[#0d1117]/95 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-teal">Send feedback</p>
            <h2 id="feedback-title" className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">
              Help make PixTaffy better
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close feedback" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:hover:bg-[#21262d] dark:hover:text-white">
            <X size={20} />
          </button>
        </div>

        {issue ? (
          <div className="px-5 py-8 text-center sm:px-8 sm:py-12">
            <img
              src="/brand/pixtaffy-taffy-crew.png"
              alt="The PixTaffy candy crew celebrates your feedback"
              className="mx-auto mb-3 w-full max-w-sm"
            />
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-brand-teal dark:bg-teal-950/40">
              <Send size={24} />
            </div>
            <h3 className="mt-5 text-2xl font-bold text-slate-950 dark:text-white">Your note is on the board</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-300">
              PixTaffy created GitHub issue #{issue.number}. You can follow the conversation there, even without a GitHub account.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <a href={issue.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-red px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-red/20 transition-colors hover:bg-red-700">
                View issue <ExternalLink size={16} />
              </a>
              <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-brand-teal hover:text-brand-teal dark:border-[#30363d] dark:text-slate-200">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void sendFeedback(event)} className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
            <fieldset>
              <legend className="text-sm font-bold text-slate-900 dark:text-white">What kind of note is this?</legend>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CATEGORIES.map((item) => {
                  const Icon = item.icon;
                  const selected = category === item.value;
                  return (
                    <button key={item.value} type="button" aria-pressed={selected} onClick={() => setCategory(item.value)} className={`min-h-[84px] rounded-xl border p-3 text-left transition-colors ${selected ? 'border-brand-teal bg-teal-50 text-teal-900 ring-1 ring-brand-teal dark:bg-teal-950/30 dark:text-teal-100' : 'border-slate-200 text-slate-700 hover:border-slate-400 dark:border-[#30363d] dark:text-slate-200 dark:hover:border-slate-500'}`}>
                      <span className="flex items-center gap-2 text-sm font-bold"><Icon size={16} className={selected ? 'text-brand-teal' : 'text-slate-500'} />{item.label}</span>
                      <span className="mt-1 block text-xs leading-4 text-slate-500 dark:text-slate-400">{item.hint}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="block">
              <span className="text-sm font-bold text-slate-900 dark:text-white">Your note</span>
              <textarea ref={textareaRef} rows={6} maxLength={8000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What happened, or what would make PixTaffy more useful?" className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20 dark:border-[#30363d] dark:bg-[#161b22] dark:text-white" />
              <span className="mt-1 block text-right text-xs text-slate-400">{message.length.toLocaleString()} / 8,000</span>
            </label>

            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-slate-900 dark:text-white">Screenshot <span className="font-normal text-slate-400">(optional)</span></span>
                {screenshot && <button type="button" onClick={() => setScreenshot(null)} className="text-xs font-bold text-brand-red hover:underline">Remove</button>}
              </div>
              {previewUrl ? (
                <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left dark:border-[#30363d] dark:bg-[#161b22]">
                  <img src={previewUrl} alt="Feedback screenshot preview" className="max-h-64 w-full object-contain" />
                  <span className="block truncate px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{screenshot?.name}</span>
                </button>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 flex min-h-20 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm font-semibold text-slate-600 transition-colors hover:border-brand-teal hover:text-brand-teal dark:border-[#30363d] dark:text-slate-300">
                  <ImagePlus size={18} /> Add a screenshot
                </button>
              )}
              <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { acceptScreenshot(event.target.files?.[0]); event.target.value = ''; }} />
              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Screenshots appear on the public GitHub issue. Make sure there is nothing private in the image.</p>
            </div>

            <label className="block">
              <span className="text-sm font-bold text-slate-900 dark:text-white">Contact email <span className="font-normal text-slate-400">(optional)</span></span>
              <input type="email" maxLength={320} value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="you@example.com" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-900 outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20 dark:border-[#30363d] dark:bg-[#161b22] dark:text-white" />
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">This stays private in Firebase and is never posted to GitHub.</p>
            </label>

            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</p>}

            <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur dark:border-[#30363d] dark:bg-[#0d1117]/95 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
              <button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50 dark:border-[#30363d] dark:text-slate-200">Cancel</button>
              <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-red px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-red/20 transition-colors hover:bg-red-700 disabled:cursor-wait disabled:opacity-60">
                <Send size={16} /> {busy ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
};
