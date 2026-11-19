// A Kernel capture token is "<payment-method-id>.<secret>". It is a single-use
// capability for one card enrollment, not an API key.
const captureTokenPattern = /^[a-z0-9]{1,64}\.[A-Za-z0-9_-]{43}$/;

export function readCaptureToken(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const tokens = params.getAll('token');
  if (tokens.length !== 1 || Array.from(params.keys()).some((key) => key !== 'token')) return null;
  return captureTokenPattern.test(tokens[0]) ? tokens[0] : null;
}
