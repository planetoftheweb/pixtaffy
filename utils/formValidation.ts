interface AuthFormState {
  isLogin: boolean;
  name: string;
  username: string;
  email: string;
  password: string;
}

export function getAuthFormBlocker({ isLogin, name, username, email, password }: AuthFormState): string | null {
  if (!isLogin && !name.trim()) return 'Name is required';
  if (!isLogin && !username.trim()) return 'Username is required';
  if (!email.trim()) return isLogin ? 'Enter your email or username first.' : 'Email address is required.';
  if (!isLogin && !/^[^\s@]+@[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (!password) return 'Password is required';
  return null;
}

export function getFeedbackFormBlocker(message: string, contactEmail?: string): string | null {
  if (message.trim().length < 3) return 'Write a short note so we know what to look at.';
  if (contactEmail?.trim() && !/^[^\s@]+@[^\s@]+$/.test(contactEmail.trim())) return 'Enter a valid email address.';
  return null;
}
