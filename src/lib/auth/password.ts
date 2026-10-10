import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function passwordStrengthIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push('at least 8 characters');
  if (!/[A-Za-z]/.test(pw)) issues.push('a letter');
  if (!/[0-9]/.test(pw)) issues.push('a number');
  return issues;
}
