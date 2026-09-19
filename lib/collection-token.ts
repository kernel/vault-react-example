const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function readCollectionToken(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const tokens = params.getAll('token');
  if (tokens.length !== 1 || Array.from(params.keys()).some((key) => key !== 'token')) return null;
  return tokenPattern.test(tokens[0]) ? tokens[0] : null;
}
