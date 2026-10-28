import { FOCUS_RING } from '../../utils/focusRing';
import React from 'react';
import { Key, Trash2, CheckCircle } from 'lucide-react';
import { Tip } from './Tip';
import { useConfirmAction } from '../../hooks/useConfirmAction';
import { keyRowStatus, keyFeedback } from './keyPresentation';
import './settings.css';
import { RichSelect as BaseRichSelect } from '../RichSelect';

function controlText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(controlText).join(' ');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return controlText(node.props.children);
  return '';
}

export function SettingsButton({ tip, children, disabled, disabledReason, onClick, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tip?: string; disabledReason?: string }) {
  const reasonId = React.useId();
  const hint = disabled ? disabledReason || 'This action is unavailable' : tip || props['aria-label'] || controlText(children);
  return <span className="relative inline-flex" data-tip-expanded={props['aria-expanded']}>
    <button type="button" {...props} className={`${className || ''} ${FOCUS_RING} [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed`}
      aria-disabled={disabled} aria-describedby={disabled ? reasonId : undefined}
      onClick={event => { if (disabled) { event.preventDefault(); event.stopPropagation(); return; } onClick?.(event); }}>{children}</button>
    <Tip text={hint} />
    {disabled && <span id={reasonId} className="sr-only">{hint}</span>}
  </span>;
}

export function SettingsSurface({ children }: { children: React.ReactNode }) {
  return <div className="settings-surface min-h-screen bg-gray-50 dark:bg-dark-bg text-slate-800 dark:text-slate-100 transition-colors">{children}</div>;
}

function useKeyConfirmation(onDelete: () => Promise<void>) {
  const [busy, setBusy] = React.useState(false);
  const confirm = useConfirmAction({ timeoutMs: 10000, onConfirm: async () => {
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  } });
  React.useEffect(() => {
    if (!confirm.armedKey) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); confirm.reset(); }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [confirm.armedKey, confirm.reset]);
  return { busy, confirm };
}

const destructiveClass = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 dark:border-red-800 px-2.5 text-[13px] font-medium text-red-700 dark:text-red-300 hover:bg-red-500/10 disabled:opacity-40';

export function KeyRow({ slot, label, description, value, placeholder, status, feedback, feedbackId, onChange, onBlur, onDelete }: {
  slot: string; label: string; description: string; value: string; placeholder: string;
  status?: { hasKey: boolean; last4?: string }; feedback: string; feedbackId: number;
  onChange: (value: string) => void; onBlur: () => void; onDelete: () => Promise<void>;
}) {
  const { busy, confirm } = useKeyConfirmation(onDelete);
  const [inlineStatus, setInlineStatus] = React.useState('');
  const statusTimer = React.useRef<number | undefined>(undefined);
  const hadSavedKey = React.useRef(!!status?.hasKey);
  React.useEffect(() => {
    if (status?.hasKey) hadSavedKey.current = true;
  }, [status?.hasKey]);
  React.useEffect(() => () => window.clearTimeout(statusTimer.current), []);
  React.useEffect(() => {
    const action = feedback.includes(keyFeedback(slot, 'saved')) ? 'Saved'
      : feedback.includes(keyFeedback(slot, 'deleted')) || (feedback === 'All keys deleted' && hadSavedKey.current) ? 'Deleted' : '';
    if (!action) return;
    if (action === 'Deleted') hadSavedKey.current = false;
    window.clearTimeout(statusTimer.current);
    setInlineStatus(action);
    statusTimer.current = window.setTimeout(() => setInlineStatus(''), 4000);
    // Status hydration alone must never announce a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, feedbackId, slot]);
  const providerName = slot === 'gemini' ? 'Gemini' : label.replace(' API Key', '');
  return <div className="border-b border-gray-200 dark:border-dark-border py-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2" data-key-row={slot} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) confirm.reset(); }}>
    <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={`key-${slot}`} className="flex items-center gap-2 text-[13px] font-semibold"><Key size={14} className="text-brand-teal" />{label.replace(' API Key', '')}</label>
      <div className="flex items-center gap-2">
        {inlineStatus && <span className="inline-flex items-center gap-1 text-[12px] text-brand-teal"><CheckCircle size={14} />{inlineStatus}</span>}
        <span className={`rounded-md px-2 py-1 text-[12px] ${status?.hasKey ? 'bg-brand-teal/10 text-brand-teal' : 'bg-gray-100 dark:bg-dark-hover text-slate-500 dark:text-slate-400'}`}>{keyRowStatus(status)}</span>
      </div>
    </div>
    <div className="relative min-w-0"><input id={`key-${slot}`} type="password" aria-label={`${label} key`} data-key-slot={slot}
      value={value} placeholder={placeholder} autoComplete="off" onChange={e => onChange(e.target.value)} onBlur={onBlur}
      className="w-full min-w-0 rounded-lg border border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-bg px-2.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-teal" />
      <Tip text={description} wide />
    </div>
    <SettingsButton aria-label="Delete key" aria-expanded={confirm.isArmed(slot)} disabled={!status?.hasKey || busy} disabledReason={busy ? 'Deleting key…' : 'No saved key to delete'}
      onClick={() => { if (!confirm.isArmed(slot)) confirm.trigger(slot); }}
      tip={`Delete the saved ${providerName} key.`} className={destructiveClass}>
      <Trash2 size={14} /><span>{busy ? 'Deleting…' : 'Delete'}</span>
    </SettingsButton>
    {confirm.isArmed(slot) && <div className="col-span-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 p-2 text-[13px]" role="group" aria-label={`Delete ${providerName} key confirmation`}>
      <span className="w-full sm:w-auto sm:flex-1">Delete your {providerName} key?</span>
      <SettingsButton aria-label="Confirm delete" onClick={() => confirm.trigger(slot)} className={destructiveClass}>Delete</SettingsButton>
      <SettingsButton onClick={confirm.reset} className="rounded-md px-2.5 hover:bg-brand-teal/10">Cancel</SettingsButton>
    </div>}
  </div>;
}

export function DeleteAllKeys({ disabled, onDelete }: { disabled: boolean; onDelete: () => Promise<void> }) {
  const { busy, confirm } = useKeyConfirmation(onDelete);
  return <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) confirm.reset(); }}>
    <SettingsButton aria-label="Delete all keys" aria-expanded={confirm.isArmed('all')} disabled={disabled || busy} disabledReason={busy ? 'Deleting keys…' : 'No saved keys to delete'}
      onClick={() => { if (!confirm.isArmed('all')) confirm.trigger('all'); }}
      tip="Remove all provider keys and per-model overrides." className={destructiveClass}>
      <Trash2 size={14} />{busy ? 'Deleting…' : 'Delete all keys'}
    </SettingsButton>
    {confirm.isArmed('all') && <div className="mt-2 space-y-2 rounded-md bg-amber-500/10 p-3 text-[13px]" role="group" aria-label="Delete all keys confirmation">
      <p>Delete all saved keys? This removes:</p>
      <ul className="list-disc pl-5"><li>Gemini, OpenAI, and OpenRouter provider keys</li><li>All per-model key overrides</li></ul>
      <div className="flex gap-2">
        <SettingsButton aria-label="Confirm delete all keys" onClick={() => confirm.trigger('all')} className={destructiveClass}>Delete all keys</SettingsButton>
        <SettingsButton onClick={confirm.reset} className="rounded-md px-2.5 hover:bg-brand-teal/10">Cancel</SettingsButton>
      </div>
    </div>}
  </div>;
}

export function SettingsInput(props: React.ComponentPropsWithRef<'input'>) {
  const hint = props['aria-label'] || props.placeholder || 'Toggle this preference.';
  return <><input {...props} className={`${props.className || ''} ${FOCUS_RING}`} aria-label={props['aria-label'] || (props.type !== 'checkbox' ? props.placeholder : undefined)} />{props.type !== 'file' && <Tip text={hint} wide />}</>;
}

export function SettingsSelect(props: React.ComponentProps<typeof BaseRichSelect>) {
  return <div className="min-w-0"><BaseRichSelect {...props} buttonClassName="!py-1.5 sm:h-9" /><Tip text={`Choose your default ${props.subLabel?.toLowerCase() || 'option'}. Changes apply when you save settings.`} wide /></div>;
}
