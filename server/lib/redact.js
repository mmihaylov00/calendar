// Keep display credentials out of server error logs.
const PATTERNS = [
  [/(\/d\/)[^/?#\s"']+/gi, '$1[redacted]'],
  [/([?&](?:k|key|sessionId|sid)=)[^&#\s"']+/gi, '$1[redacted]'],
  [/\bmd_[A-Za-z0-9_-]{20,}/g, 'md_[redacted]'],
];

/** `s` with display keys, device tokens and pairing ids replaced by "[redacted]". */
export function redactSecrets(s) {
  let out = String(s ?? '');
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

