import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Kernel from '@onkernel/sdk';
import { FileCollectionRequestStore } from '../lib/request-store';
import { collectionTokenDigest, createCollectionToken } from '../lib/server-token';
import { createCollectionKey } from '../lib/collection-keys';
import { localPrivateKeyProtector } from '../lib/private-key-protector';

const mock = process.env.MOCK_VAULT === 'true';
const [vaultArg, itemArg] = process.argv.slice(2);
if (!mock && (!vaultArg || !itemArg)) {
  throw new Error('usage: bun run create-request -- <vault-id-or-name> <item-key>');
}

const appOrigin = new URL(required('APP_ORIGIN')).origin;
const protector = localPrivateKeyProtector();
const ttlMinutes = Number(process.env.COLLECTION_REQUEST_TTL_MINUTES ?? '15');
if (!Number.isSafeInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 24 * 60) {
  throw new Error('COLLECTION_REQUEST_TTL_MINUTES must be an integer from 1 to 1440');
}

let vaultId = vaultArg ?? 'mock-vault';
let itemKey = itemArg ?? 'mock-credential';
let itemId = `mock-${randomUUID()}`;

if (!mock) {
  const kernel = new Kernel({
    apiKey: required('KERNEL_API_KEY'),
    maxRetries: 0,
    logLevel: 'off',
    ...(process.env.KERNEL_API_BASE_URL ? { baseURL: process.env.KERNEL_API_BASE_URL } : {}),
  });
  const item = await kernel.vaults.items.retrieve(itemKey, { id_or_name: vaultId }).catch(() => {
    throw new Error('unable to retrieve the credential item');
  });
  if (item.type !== 'credential') throw new Error('the selected vault item is not a credential');
  itemId = item.id;
}

const token = createCollectionToken();
const store = new FileCollectionRequestStore(
  join(process.cwd(), '.data', 'credential-requests.json'),
);
const id = randomUUID();
await store.save({
  id,
  tokenDigest: collectionTokenDigest(token),
  vaultId,
  itemKey,
  itemId,
  key: await createCollectionKey(id, itemId, protector),
  expiresAt: Date.now() + ttlMinutes * 60_000,
  consumedAt: null,
  revokedAt: null,
});

const url = new URL('/credentials/collect', appOrigin);
url.hash = `token=${token}`;
process.stdout.write(`${url.toString()}\n`);

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
