export const SHOW_TEAMS_SETTINGS = false;

export function keyFeedback(slot: string, action: 'saved' | 'deleted'): string {
  const provider = ({ gemini: 'Gemini', openai: 'OpenAI', openrouter: 'OpenRouter' } as Record<string, string>)[slot] || slot;
  return `${provider} key ${action}`;
}

export function keyRowStatus(status?: { hasKey: boolean; last4?: string }): string {
  return status?.hasKey ? `Saved …${status.last4 || ''}` : 'Not set';
}
