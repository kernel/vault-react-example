import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollectionKey, decryptSubmission, keyBinding } from '../lib/collection-keys';
import { encryptSubmission, MAX_PLAINTEXT_BYTES } from '../lib/credential-envelope';
import { LocalPrivateKeyProtector } from '../lib/private-key-protector';
import { FileCollectionRequestStore, type CollectionRequest } from '../lib/request-store';

const protector = () => new LocalPrivateKeyProtector(randomBytes(32).toString('base64'));

test('creates independent keys and persists only wrapped private material, clearing it on consumption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-keys-'));
  try {
    const wrapping = protector();
    const key = await createCollectionKey('request-1', 'item-1', wrapping);
    const other = await createCollectionKey('request-2', 'item-1', wrapping);
    expect(key.keyId).not.toBe(other.keyId);
    expect(key.publicKey).not.toEqual(other.publicKey);
    expect(key.publicKey.d).toBeUndefined();
    const request: CollectionRequest = {
      id: 'request-1', itemId: 'item-1', itemKey: 'item', vaultId: 'vault', tokenDigest: 'digest',
      expiresAt: Date.now() + 60_000, revokedAt: null, consumedAt: null, key,
    };
    const path = join(directory, 'requests.json');
    const store = new FileCollectionRequestStore(path);
    await store.save(request);
    const contents = await readFile(path, 'utf8');
    expect(contents).not.toContain('PRIVATE KEY');
    expect(contents).not.toContain('"d":');
    const unwrapped = await wrapping.unwrap(key.wrappedPrivateKey!, keyBinding(request));
    expect(contents).not.toContain(new TextDecoder().decode(unwrapped));
    unwrapped.fill(0);

    const body = { version: 1, fields: { password: { value: 'synthetic value' } } };
    const envelope = await encryptSubmission(body, { ...keyBinding(request), version: 1, publicKey: key.publicKey });
    const restored = await new FileCollectionRequestStore(path).findByTokenDigest('digest');
    expect((await decryptSubmission(envelope, restored!, wrapping)).submission).toEqual(body);
    await expect(store.markConsumed('missing', Date.now())).rejects.toThrow();
    await store.save({ ...request, id: 'request-2', tokenDigest: 'other-digest', key: other });
    await Promise.all([
      store.markConsumed('digest', Date.now()),
      store.markConsumed('other-digest', Date.now()),
    ]);
    expect((await store.findByTokenDigest('other-digest'))!.key.wrappedPrivateKey).toBeNull();
    const consumed = await store.findByTokenDigest('digest');
    expect(consumed!.key.wrappedPrivateKey).toBeNull();
    expect(await readFile(path, 'utf8')).not.toContain(key.wrappedPrivateKey!);
    await expect(decryptSubmission(envelope, consumed!, wrapping)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('wrapping rejects a wrong wrapping key, tampering, or a transplanted request/item/key binding', async () => {
  const wrapping = protector();
  const key = await createCollectionKey('request-1', 'item-1', wrapping);
  const binding = { requestId: 'request-1', itemId: 'item-1', keyId: key.keyId };
  await expect(protector().unwrap(key.wrappedPrivateKey!, binding)).rejects.toThrow();
  for (const field of ['requestId', 'itemId', 'keyId'] as const) {
    await expect(wrapping.unwrap(key.wrappedPrivateKey!, { ...binding, [field]: 'other' })).rejects.toThrow();
  }
  const parts = key.wrappedPrivateKey!.split('.');
  parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  await expect(wrapping.unwrap(parts.join('.'), binding)).rejects.toThrow();
});

test('requires a correctly encoded 32-byte wrapping key', () => {
  for (const value of ['', 'not-base64', randomBytes(16).toString('base64'), randomBytes(33).toString('base64')]) {
    expect(() => new LocalPrivateKeyProtector(value)).toThrow('32 random bytes');
  }
});

test('browser encryption rejects oversized plaintext and inconsistent rendered versions', async () => {
  const key = await createCollectionKey('request-1', 'item-1', protector());
  const encryption = { requestId: 'request-1', itemId: 'item-1', keyId: key.keyId, publicKey: key.publicKey, version: 1 };
  await expect(encryptSubmission({ version: 2, fields: {} }, encryption)).rejects.toThrow();
  await expect(encryptSubmission({
    version: 1, fields: { password: { value: 'x'.repeat(MAX_PLAINTEXT_BYTES) } },
  }, encryption)).rejects.toThrow();
});
