import { randomUUID } from 'node:crypto';
import {
  compactDecrypt, decodeProtectedHeader, exportJWK, exportPKCS8, generateKeyPair, importPKCS8,
  type JWK,
} from 'jose';
import {
  CONTENT_ALGORITHM, ENVELOPE_TYPE, KEY_ALGORITHM, MAX_ENVELOPE_BYTES, MAX_PLAINTEXT_BYTES,
  type KeyBinding,
} from './credential-envelope';
import type { PrivateKeyProtector } from './private-key-protector';
import type { CollectionRequest } from './request-store';

export type CollectionKey = {
  keyId: string;
  publicKey: JWK;
  wrappedPrivateKey: string | null;
};

export function keyBinding(request: CollectionRequest): KeyBinding {
  return { keyId: request.key.keyId, requestId: request.id, itemId: request.itemId };
}

export async function createCollectionKey(
  requestId: string,
  itemId: string,
  protector: PrivateKeyProtector,
): Promise<CollectionKey> {
  const keyId = randomUUID();
  const { publicKey, privateKey } = await generateKeyPair(KEY_ALGORITHM, {
    crv: 'P-256', extractable: true,
  });
  const privateBytes = new TextEncoder().encode(await exportPKCS8(privateKey));
  try {
    return {
      keyId,
      publicKey: await exportJWK(publicKey),
      wrappedPrivateKey: await protector.wrap(privateBytes, { keyId, requestId, itemId }),
    };
  } finally {
    privateBytes.fill(0);
  }
}

export async function decryptSubmission(
  envelope: string,
  request: CollectionRequest,
  protector: PrivateKeyProtector,
): Promise<{ submission: unknown; version: number }> {
  if (
    envelope.length > MAX_ENVELOPE_BYTES ||
    !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){4}$/.test(envelope) ||
    envelope.indexOf('.') > 2048 || !request.key.wrappedPrivateKey
  ) throw new Error('invalid envelope');

  const header = decodeProtectedHeader(envelope);
  if (
    header.alg !== KEY_ALGORITHM || header.enc !== CONTENT_ALGORITHM ||
    header.typ !== ENVELOPE_TYPE || header.kid !== request.key.keyId ||
    header.request_id !== request.id || header.item_id !== request.itemId ||
    !Number.isSafeInteger(header.version) || Number(header.version) < 1
  ) throw new Error('invalid envelope');

  const privateBytes = await protector.unwrap(request.key.wrappedPrivateKey, keyBinding(request));
  try {
    const key = await importPKCS8(new TextDecoder().decode(privateBytes), KEY_ALGORITHM);
    const { plaintext } = await compactDecrypt(envelope, key, {
      keyManagementAlgorithms: [KEY_ALGORITHM],
      contentEncryptionAlgorithms: [CONTENT_ALGORITHM],
    });
    try {
      if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) throw new Error('invalid submission');
      return {
        submission: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)),
        version: Number(header.version),
      };
    } finally {
      plaintext.fill(0);
    }
  } finally {
    privateBytes.fill(0);
  }
}
