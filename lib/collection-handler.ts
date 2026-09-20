import { safeCredentialItem, type CredentialSubmission } from '@onkernel/vault-react/data';
import type { CollectionRequestStore } from './request-store';
import { collectionTokenDigest } from './server-token';
import { decryptSubmission, keyBinding } from './collection-keys';
import { MAX_ENVELOPE_BYTES } from './credential-envelope';
import type { PrivateKeyProtector } from './private-key-protector';
import {
  VaultConflictError,
  VaultInvalidRequestError,
  type CredentialVaultClient,
} from './vault-client';

const bearerPattern = /^Bearer ([A-Za-z0-9_-]{43})$/;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

async function readEnvelope(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ENVELOPE_BYTES) {
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
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

export function createCollectionHandler({
  appOrigin,
  store,
  vault,
  protector,
  now = Date.now,
}: {
  appOrigin: string;
  store: CollectionRequestStore;
  vault: CredentialVaultClient;
  protector: PrivateKeyProtector;
  now?: () => number;
}) {
  const trustedOrigin = new URL(appOrigin).origin;
  // Local-only serialization. Production needs a durable, distributed request claim.
  const submitting = new Set<string>();

  return async (request: Request): Promise<Response> => {
    let claimedDigest: string | undefined;
    try {
      if (!['GET', 'PATCH'].includes(request.method)) return json({ code: 'invalid' }, 405);
      const bearer = bearerPattern.exec(request.headers.get('Authorization') ?? '')?.[1];
      if (!bearer) return json({ code: 'unavailable' }, 401);

      const digest = collectionTokenDigest(bearer);
      if (request.method === 'PATCH') {
        if (request.headers.get('Origin') !== trustedOrigin) return json({ code: 'unavailable' }, 403);
        if (submitting.has(digest)) return json({ code: 'unavailable' }, 409);
        submitting.add(digest);
        claimedDigest = digest;
      }
      const mapping = await store.findByTokenDigest(digest);
      if (!mapping) return json({ code: 'unavailable' }, 404);
      if (mapping.revokedAt !== null) return json({ code: 'unavailable' }, 410);
      if (mapping.consumedAt !== null) return json({ code: 'consumed' }, 410);
      if (mapping.expiresAt <= now()) return json({ code: 'expired' }, 410);

      const item = safeCredentialItem(await vault.retrieve(mapping));
      if (item.id !== mapping.itemId) return json({ code: 'unavailable' }, 404);
      if (request.method === 'GET') {
        const { x, y } = mapping.key.publicKey;
        return json({
          item,
          encryption: {
            ...keyBinding(mapping),
            version: item.version,
            publicKey: { kty: 'EC', crv: 'P-256', x, y },
          },
        });
      }
      if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/jose') {
        return json({ code: 'invalid' }, 400);
      }

      let body: unknown;
      let boundVersion: number;
      try {
        const decrypted = await decryptSubmission(await readEnvelope(request), mapping, protector);
        body = decrypted.submission;
        boundVersion = decrypted.version;
      } catch {
        return json({ code: 'invalid' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ code: 'invalid' }, 400);
      }
      const input = body as Record<string, unknown>;
      if (
        input.version !== boundVersion ||
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
        const replacement = edit as Record<string, unknown>;
        if (
          Object.keys(replacement).length !== 1 ||
          !Object.hasOwn(replacement, 'value') ||
          (replacement.value === null && field.required) ||
          (replacement.value !== null &&
            (typeof replacement.value !== 'string' ||
              replacement.value.length === 0 ||
              new TextEncoder().encode(replacement.value).length > 16 * 1024))
        ) {
          return json({ code: 'invalid' }, 400);
        }
      }

      const submission = input as CredentialSubmission;
      if (submission.version !== item.version) return json({ code: 'stale' }, 409);
      if (!entries.length) {
        await store.markConsumed(digest, now());
        return json({ unchanged: true });
      }

      try {
        const updated = safeCredentialItem(await vault.update(mapping, submission));
        if (updated.id !== mapping.itemId) throw new Error('unexpected vault item');
        await store.markConsumed(digest, now());
        return json({ saved: true });
      } catch (error) {
        if (error instanceof VaultConflictError) return json({ code: 'stale' }, 409);
        if (error instanceof VaultInvalidRequestError) return json({ code: 'invalid' }, 400);
        throw error;
      }
    } catch {
      return json({ code: 'unavailable' }, 502);
    } finally {
      if (claimedDigest) submitting.delete(claimedDigest);
    }
  };
}
