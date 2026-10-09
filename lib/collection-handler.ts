import { safeCredentialItem } from '@onkernel/vault-react/data';
import type { EncryptedSubmission } from './encrypted-submission';
import type { CollectionRequestStore } from './request-store';
import { collectionTokenDigest } from './server-token';
import {
  VaultConflictError,
  VaultInvalidRequestError,
  type CredentialVaultClient,
} from './vault-client';

const bearerPattern = /^Bearer ([A-Za-z0-9_-]{43})$/;
// Compact JWE: five base64url segments. Kernel rejects anything it cannot decrypt.
const compactJwePattern = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*){4}$/;
const maxEncryptedValueLength = 24 * 1024;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) {
        await reader.cancel();
        throw new Error('invalid request');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

export function createCollectionHandler({
  appOrigin,
  store,
  vault,
  now = Date.now,
}: {
  appOrigin: string;
  store: CollectionRequestStore;
  vault: CredentialVaultClient;
  now?: () => number;
}) {
  const trustedOrigin = new URL(appOrigin).origin;

  return async (request: Request): Promise<Response> => {
    try {
      if (!['GET', 'PATCH'].includes(request.method)) return json({ code: 'invalid' }, 405);
      const bearer = bearerPattern.exec(request.headers.get('Authorization') ?? '')?.[1];
      if (!bearer) return json({ code: 'unavailable' }, 401);

      const digest = collectionTokenDigest(bearer);
      const mapping = await store.findByTokenDigest(digest);
      if (!mapping) return json({ code: 'unavailable' }, 404);
      if (mapping.revokedAt !== null) return json({ code: 'unavailable' }, 410);
      if (mapping.consumedAt !== null) return json({ code: 'consumed' }, 410);
      if (mapping.expiresAt <= now()) return json({ code: 'expired' }, 410);
      if (request.method === 'PATCH' && request.headers.get('Origin') !== trustedOrigin) {
        return json({ code: 'unavailable' }, 403);
      }

      const item = safeCredentialItem(await vault.retrieve(mapping));
      if (item.id !== mapping.itemId) return json({ code: 'unavailable' }, 404);
      if (request.method === 'GET') {
        const { kid, jwk } = await vault.encryptionKey(mapping);
        return json({ item, encryption_key: { kid, jwk } });
      }
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
        return json({ code: 'invalid' }, 400);
      }

      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return json({ code: 'invalid' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ code: 'invalid' }, 400);
      }
      const input = body as Record<string, unknown>;
      if (
        !Number.isSafeInteger(input.version) ||
        Number(input.version) < 1 ||
        !input.fields ||
        typeof input.fields !== 'object' ||
        Array.isArray(input.fields) ||
        Object.keys(input).some((key) => !['version', 'fields'].includes(key))
      ) {
        return json({ code: 'invalid' }, 400);
      }

      const entries = Object.entries(input.fields);
      if (entries.length > 32) return json({ code: 'invalid' }, 400);
      for (const [name, edit] of entries) {
        const field = item.spec.fields.find((definition) => definition.name === name);
        if (!field || field.type === 'totp' || !edit || typeof edit !== 'object' || Array.isArray(edit)) {
          return json({ code: 'invalid' }, 400);
        }
        // Plaintext values are rejected: this backend only ever relays ciphertext or a clear.
        const replacement = edit as Record<string, unknown>;
        const encrypted = replacement.encrypted_value;
        const clear = Object.hasOwn(replacement, 'value') && replacement.value === null && !field.required;
        const ciphertext = typeof encrypted === 'string' &&
          encrypted.length <= maxEncryptedValueLength &&
          compactJwePattern.test(encrypted);
        if (Object.keys(replacement).length !== 1 || !(clear || ciphertext)) {
          return json({ code: 'invalid' }, 400);
        }
      }

      const submission = input as EncryptedSubmission;
      if (submission.version !== item.version) return json({ code: 'stale' }, 409);
      if (!entries.length) {
        await store.markConsumed(digest, now());
        return json({ unchanged: true });
      }

      try {
        const updated = safeCredentialItem(await vault.update(mapping, submission));
        await store.markConsumed(digest, now());
        return json(updated);
      } catch (error) {
        if (error instanceof VaultConflictError) return json({ code: 'stale' }, 409);
        if (error instanceof VaultInvalidRequestError) return json({ code: 'invalid' }, 400);
        throw error;
      }
    } catch {
      return json({ code: 'unavailable' }, 502);
    }
  };
}
