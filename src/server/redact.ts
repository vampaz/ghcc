const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

export function redactToken(input: string, secret?: string | null): string {
  let out = input.replace(TOKEN_PATTERN, '[REDACTED]');
  if (secret && secret.length >= 6) {
    out = out.split(secret).join('[REDACTED]');
  }
  return out;
}

export function sanitizeErrorMessage(err: unknown, secret?: string | null): string {
  if (err instanceof Error) {
    return redactToken(err.message, secret);
  }
  return redactToken(String(err), secret);
}
