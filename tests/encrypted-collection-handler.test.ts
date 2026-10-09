import { expect, mock, test } from 'bun:test';
import type { CredentialItem } from '@onkernel/vault-react/data';
import { createCollectionHandler } from '../lib/collection-handler';
import type { EncryptedSubmission, VaultEncryptionKey } from '../lib/encrypted-submission';
import type { CollectionRequest, CollectionRequestStore } from '../lib/request-store';
import { collectionTokenDigest } from '../lib/server-token';
import { VaultConflictError, type CredentialVaultClient } from '../lib/vault-client';

const origin = 'https://app.example.com';
const token = 'a'.repeat(43);
const digest = collectionTokenDigest(token);
const authorization = `Bearer ${token}`;
const now = 1_700_000_000_000;
const encryptionKey: VaultEncryptionKey = { kid: 'vtk_example', jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } };
const jwe = 'eyJhbGciOiJFQ0RILUVTIn0..aXY.Y2lwaGVydGV4dA.dGFn';

function credentialItem(): CredentialItem {
  return {
    id: 'vi_example',
    type: 'credential',
    version: 7,
    spec: {
      description: 'Example',
      fields: [
        { name: 'password', type: 'password', required: true, sensitive: true },
        { name: 'note', type: 'text', required: false, sensitive: false },
        { name: 'otp', type: 'totp', required: false, sensitive: true },
      ],
    },
    state: {
      status: 'pending_collection',
      fields: {
        password: { has_value: true },
        note: { has_value: true, value: 'saved' },
        otp: { has_value: true },
      },
    },
  };
}

class MemoryStore implements CollectionRequestStore {
  request: CollectionRequest | null = {
    id: 'request-1',
    tokenDigest: digest,
    vaultId: 'server-vault',
    itemKey: 'server-key',
    itemId: 'vi_example',
    expiresAt: now + 60_000,
    consumedAt: null,
    revokedAt: null,
  };

  async findByTokenDigest(candidate: string) {
    return candidate === digest ? this.request : null;
  }

  async save(request: CollectionRequest) {
    this.request = request;
  }

  async markConsumed(candidate: string, consumedAt: number) {
    if (!this.request || candidate !== digest) throw new Error('not found');
    this.request.consumedAt = consumedAt;
  }
}

function setup() {
  const store = new MemoryStore();
  const retrieve = mock(async (_request: CollectionRequest): Promise<unknown> => credentialItem());
  const update = mock(
    async (_request: CollectionRequest, _submission: EncryptedSubmission): Promise<unknown> => ({
      ...credentialItem(),
      version: 8,
    }),
  );
  const vault: CredentialVaultClient = { retrieve, encryptionKey: async () => encryptionKey, update };
  const handler = createCollectionHandler({ appOrigin: origin, store, vault, encrypted: true, now: () => now });
  return { handler, store, retrieve, update };
}

const get = (bearer = authorization) =>
  new Request(`${origin}/api/credential-requests/current-encrypted`, {
    headers: bearer ? { Authorization: bearer } : {},
  });

const patch = (body: unknown, requestOrigin = origin, bearer = authorization) =>
  new Request(`${origin}/api/credential-requests/current-encrypted`, {
    method: 'PATCH',
    headers: { Authorization: bearer, Origin: requestOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('only a valid fragment bearer can authorize a request', async () => {
  const { handler, retrieve } = setup();
  for (const request of [get(''), get('Bearer request_123'), get(`Bearer ${'a'.repeat(42)}`)]) {
    expect((await handler(request)).status).toBe(401);
  }
  expect(retrieve).not.toHaveBeenCalled();
});

test('returns the safe item projection and the vault encryption key', async () => {
  const { handler } = setup();
  const response = await handler(get());
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(await response.json()).toEqual({ item: credentialItem(), encryption_key: encryptionKey });
});

test('rejects expired, consumed, revoked, and replaced targets', async () => {
  const { handler, store, retrieve } = setup();
  store.request!.expiresAt = now;
  expect((await handler(get())).status).toBe(410);
  store.request!.expiresAt = now + 60_000;
  store.request!.consumedAt = now - 1;
  expect(await (await handler(get())).json()).toEqual({ code: 'consumed' });
  store.request!.consumedAt = null;
  store.request!.revokedAt = now - 1;
  expect((await handler(get())).status).toBe(410);
  store.request!.revokedAt = null;
  retrieve.mockImplementationOnce(async () => ({ ...credentialItem(), id: 'vi_replacement' }));
  expect((await handler(get())).status).toBe(404);
});

test('rejects cross-origin writes before loading the item', async () => {
  const { handler, retrieve } = setup();
  const response = await handler(
    patch({ version: 7, fields: {} }, 'https://attacker.example.com'),
  );
  expect(response.status).toBe(403);
  expect(retrieve).not.toHaveBeenCalled();
});

test('relays ciphertext to the mapped target with rendered version and consumes the request', async () => {
  const { handler, store, update } = setup();
  const response = await handler(
    patch({ version: 7, fields: { password: { encrypted_value: jwe }, note: { value: null } } }),
  );
  expect(response.status).toBe(200);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][0]).toMatchObject({
    vaultId: 'server-vault',
    itemKey: 'server-key',
    itemId: 'vi_example',
  });
  expect(update.mock.calls[0][1]).toEqual({
    version: 7,
    fields: { password: { encrypted_value: jwe }, note: { value: null } },
  });
  expect(store.request?.consumedAt).toBe(now);
  expect(await (await handler(get())).json()).toEqual({ code: 'consumed' });
});

test('unchanged completion skips the vault write and consumes the request', async () => {
  const { handler, store, update } = setup();
  expect(await (await handler(patch({ version: 7, fields: {} }))).json()).toEqual({ unchanged: true });
  expect(update).not.toHaveBeenCalled();
  expect(store.request?.consumedAt).toBe(now);
});

test('stale writes return a conflict without consuming the request', async () => {
  const { handler, store, update } = setup();
  expect((await handler(patch({ version: 6, fields: { note: { encrypted_value: jwe } } }))).status).toBe(409);
  expect(update).not.toHaveBeenCalled();
  update.mockImplementationOnce(async () => {
    throw new VaultConflictError();
  });
  expect((await handler(patch({ version: 7, fields: { note: { encrypted_value: jwe } } }))).status).toBe(409);
  expect(store.request?.consumedAt).toBeNull();
});

test('rejects plaintext values, TOTP, unknown fields, required clearing, and malformed ciphertext', async () => {
  const { handler, update } = setup();
  for (const body of [
    { version: 7, fields: { password: { value: 'plaintext' } } },
    { version: 7, fields: { note: { value: '' } } },
    { version: 7, fields: { note: { value: null, encrypted_value: jwe } } },
    { version: 7, fields: { note: { encrypted_value: 'not-a-jwe' } } },
    { version: 7, fields: { note: { encrypted_value: `${jwe}.extra` } } },
    { version: 7, fields: { note: { encrypted_value: null } } },
    { version: 7, fields: { note: { encrypted_value: `${'a'.repeat(24 * 1024)}....` } } },
    { version: 7, fields: { otp: { encrypted_value: jwe } } },
    { version: 7, fields: { unknown: { encrypted_value: jwe } } },
    { version: 7, fields: { password: { value: null } } },
    { version: 7, fields: {}, vaultId: 'attacker-vault' },
    { version: 7, fields: { note: { encrypted_value: `a${'.'.repeat(4)}${'b'.repeat(128 * 1024)}` } } },
  ]) {
    expect((await handler(patch(body))).status).toBe(400);
  }
  expect(update).not.toHaveBeenCalled();
});
