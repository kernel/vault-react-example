import { createHash, randomBytes } from 'node:crypto';

export function createCollectionToken() {
  return randomBytes(32).toString('base64url');
}

export function collectionTokenDigest(token: string) {
  return createHash('sha256').update(token).digest('base64url');
}
