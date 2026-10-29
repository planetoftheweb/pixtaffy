interface AuthFormState {
  isLogin: boolean;
  name: string;
  username: string;
  email: string;
  password: string;
}

export type AuthFormField = 'name' | 'username' | 'email' | 'password';
export type FeedbackFormField = 'message' | 'contactEmail';

export function getAuthFormBlockerField({ isLogin, name, username, email, password }: AuthFormState): AuthFormField | null {
  if (!isLogin && !name.trim()) return 'name';
  if (!isLogin && !username.trim()) return 'username';
  if (!email.trim() || (!isLogin && !/^[^\s@]+@[^\s@]+$/.test(email.trim()))) return 'email';
  if (!password) return 'password';
  return null;
}

export function getFeedbackFormBlockerField(message: string, contactEmail?: string): FeedbackFormField | null {
  if (message.trim().length < 3) return 'message';
  if (contactEmail?.trim() && !/^[^\s@]+@[^\s@]+$/.test(contactEmail.trim())) return 'contactEmail';
  return null;
}

export function getAuthFormBlocker({ isLogin, name, username, email, password }: AuthFormState): string | null {
  if (!isLogin && !name.trim()) return 'Name is required.';
  if (!isLogin && !username.trim()) return 'Username is required.';
  if (!email.trim()) return isLogin ? 'Enter your email or username first.' : 'Email address is required.';
  if (!isLogin && !/^[^\s@]+@[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (!password) return 'Password is required.';
  return null;
}

export function getFeedbackFormBlocker(message: string, contactEmail?: string): string | null {
  if (message.trim().length < 3) return 'Write a short note so we know what to look at.';
  if (contactEmail?.trim() && !/^[^\s@]+@[^\s@]+$/.test(contactEmail.trim())) return 'Enter a valid email address.';
  return null;
}
