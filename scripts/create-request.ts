import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Kernel from '@onkernel/sdk';
import { FileCollectionRequestStore } from '../lib/request-store';
import { collectionTokenDigest, createCollectionToken } from '../lib/server-token';

const mock = process.env.MOCK_VAULT === 'true';
const args = process.argv.slice(2);
// --encrypted links to the example that encrypts values in the browser.
const encrypted = args.includes('--encrypted');
const [vaultArg, itemArg] = args.filter((arg) => arg !== '--encrypted');
if (!mock && (!vaultArg || !itemArg)) {
  throw new Error('usage: bun run create-request -- [--encrypted] <vault-id-or-name> <item-key>');
}

const appOrigin = new URL(required('APP_ORIGIN')).origin;
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
    ...(process.env.KERNEL_API_BASE_URL ? { baseURL: process.env.KERNEL_API_BASE_URL } : {}),
  });
  const item = await kernel.vaults.items.retrieve(itemKey, { id_or_name: vaultId });
  if (item.type !== 'credential') throw new Error('the selected vault item is not a credential');
  itemId = item.id;
}

const token = createCollectionToken();
const store = new FileCollectionRequestStore(
  join(process.cwd(), '.data', 'credential-requests.json'),
);
await store.save({
  id: randomUUID(),
  tokenDigest: collectionTokenDigest(token),
  vaultId,
  itemKey,
  itemId,
  expiresAt: Date.now() + ttlMinutes * 60_000,
  consumedAt: null,
  revokedAt: null,
});

const url = new URL(encrypted ? '/credentials/collect-encrypted' : '/credentials/collect', appOrigin);
url.hash = `token=${token}`;
process.stdout.write(`${url.toString()}\n`);

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
