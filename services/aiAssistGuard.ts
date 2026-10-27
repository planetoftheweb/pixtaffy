export const AI_ASSIST_TIMEOUT_MS = 100_000;

export function friendlyAiAssistError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code).replace(/^functions\//, '')
    : '';
  switch (code) {
    case 'deadline-exceeded':
      return 'The AI request took too long. Please try again.';
    case 'unavailable':
      return 'AI assist is temporarily unavailable. Please try again shortly.';
    case 'resource-exhausted':
      return 'AI assist is busy or your credits are low. Check your balance and try again shortly.';
    case 'failed-precondition':
      return 'AI assist could not complete this request. Check your account and try rephrasing it.';
    case 'unauthenticated':
      return 'Sign in to use AI assist, then try again.';
    default:
      return 'AI assist could not finish. Please try again.';
  }
}

export async function withAiAssistGuard<T>(call: () => Promise<T>, timeoutMs = AI_ASSIST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(
        new Error(friendlyAiAssistError({ code: 'deadline-exceeded' })),
        { code: 'functions/deadline-exceeded' },
      )), timeoutMs);
    });
    return await Promise.race([Promise.resolve().then(call), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
