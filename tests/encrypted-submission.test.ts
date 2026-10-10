import { expect, test } from 'bun:test';
import { createCollectionHandler } from '../lib/collection-handler';
import { encryptSubmission } from '../lib/encrypted-submission';
import type { CollectionRequest, CollectionRequestStore } from '../lib/request-store';
import { collectionTokenDigest } from '../lib/server-token';
import { MockCredentialVaultClient, VaultInvalidRequestError } from '../lib/vault-client';

const origin = 'https://app.example.com';
const token = 'b'.repeat(43);
const request: CollectionRequest = {
  id: 'request-1',
  tokenDigest: collectionTokenDigest(token),
  vaultId: 'mock-vault',
  itemKey: 'mock-credential',
  itemId: 'mock-item',
  expiresAt: Date.now() + 60_000,
  consumedAt: null,
  revokedAt: null,
};

test('the browser encrypts every entered value and keeps clears as null', async () => {
  const vault = new MockCredentialVaultClient();
  const key = await vault.encryptionKey();
  const encrypted = await encryptSubmission(
    { version: 1, fields: { email: { value: 'user@example.com' }, password: { value: 'hunter2' } } },
    key,
  );
  expect(JSON.stringify(encrypted)).not.toContain('hunter2');
  expect(JSON.stringify(encrypted)).not.toContain('user@example.com');
  expect(Object.keys(encrypted.fields.password)).toEqual(['encrypted_value']);

  const cleared = await encryptSubmission({ version: 1, fields: { password: { value: null } } }, key);
  expect(cleared.fields.password).toEqual({ value: null });
});

test('ciphertext round-trips through the backend to the vault', async () => {
  const vault = new MockCredentialVaultClient();
  const stored = { ...request };
  const store: CollectionRequestStore = {
    findByTokenDigest: async (digest) => (digest === stored.tokenDigest ? stored : null),
    save: async () => {},
    markConsumed: async (_digest, consumedAt) => {
      stored.consumedAt = consumedAt;
    },
  };
  const handler = createCollectionHandler({ appOrigin: origin, store, vault, encrypted: true });
  const authorization = `Bearer ${token}`;

  const read = await handler(
    new Request(`${origin}/api/credential-requests/current`, { headers: { Authorization: authorization } }),
  );
  const { item, encryption_key } = await read.json();
  const body = JSON.stringify(
    await encryptSubmission(
      { version: item.version, fields: { email: { value: 'user@example.com' }, password: { value: 'hunter2' } } },
      encryption_key,
    ),
  );
  expect(body).not.toContain('hunter2');

  const write = await handler(
    new Request(`${origin}/api/credential-requests/current`, {
      method: 'PATCH',
      headers: { Authorization: authorization, Origin: origin, 'Content-Type': 'application/json' },
      body,
    }),
  );
  expect(write.status).toBe(200);
  const updated = await write.json();
  expect(updated.state.status).toBe('ready');
  expect(updated.state.fields.email).toEqual({ has_value: true, value: 'user@example.com' });
  expect(updated.state.fields.password).toEqual({ has_value: true });
  expect(stored.consumedAt).not.toBeNull();
});

test('the vault rejects ciphertext encrypted for another key', async () => {
  const other = await new MockCredentialVaultClient().encryptionKey();
  const encrypted = await encryptSubmission({ version: 1, fields: { password: { value: 'hunter2' } } }, other);
  await expect(new MockCredentialVaultClient().update(request, encrypted)).rejects.toBeInstanceOf(
    VaultInvalidRequestError,
  );
});
