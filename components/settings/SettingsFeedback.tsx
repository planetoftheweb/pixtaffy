import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

// Increment for every completed action, including repeated messages.
export function useSettingsFeedback() {
  const [feedback, setFeedback] = React.useState({ keyMessage: '', feedbackId: 0 });
  const setKeyMessage = (keyMessage: string) => setFeedback(previous => ({ keyMessage, feedbackId: previous.feedbackId + 1 }));
  return { ...feedback, setKeyMessage };
}

export function SettingsToast({ message, error, eventId }: { message: string; error: boolean; eventId: number }) {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (!eventId) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [eventId]);
  return createPortal(<div role="status" aria-live="polite" aria-atomic="true"
    className="fixed bottom-[calc(env(safe-area-inset-bottom)+16px)] left-3 right-3 z-[500] sm:left-auto sm:right-5 sm:max-w-sm">
    {visible && <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/90 p-3 text-[14px] text-white shadow-2xl">
      {error ? <AlertCircle size={20} className="shrink-0 text-red-400" /> : <CheckCircle size={20} className="shrink-0 text-brand-teal" />}
      <div className="min-w-0 flex-1"><span>{message}</span>
        {!error && message !== 'Settings saved successfully!' && <span className="block">Settings saved successfully!</span>}
      </div>
      <button type="button" aria-label="Dismiss notification" onClick={() => setVisible(false)} className="flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-white/10 sm:min-h-8 sm:min-w-8"><X size={16} /></button>
    </div>}
  </div>, document.body);
}
