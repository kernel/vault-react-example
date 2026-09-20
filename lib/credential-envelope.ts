import { CompactEncrypt, importJWK, type JWK } from 'jose';
import type { CredentialSubmission } from '@onkernel/vault-react/data';

export const KEY_ALGORITHM = 'ECDH-ES+A256KW';
export const CONTENT_ALGORITHM = 'A256GCM';
export const ENVELOPE_TYPE = 'credential-submission+jwe';
export const MAX_PLAINTEXT_BYTES = 128 * 1024;
export const MAX_ENVELOPE_BYTES = 192 * 1024;

export type KeyBinding = {
  keyId: string;
  requestId: string;
  itemId: string;
};

export type CollectionEncryption = KeyBinding & {
  version: number;
  publicKey: JWK;
};

export async function encryptSubmission(
  submission: CredentialSubmission,
  encryption: CollectionEncryption,
): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(submission));
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES || submission.version !== encryption.version) {
    throw new Error('invalid submission');
  }
  const key = await importJWK(encryption.publicKey, KEY_ALGORITHM);
  const envelope = await new CompactEncrypt(plaintext)
    .setProtectedHeader({
      alg: KEY_ALGORITHM,
      enc: CONTENT_ALGORITHM,
      typ: ENVELOPE_TYPE,
      kid: encryption.keyId,
      request_id: encryption.requestId,
      item_id: encryption.itemId,
      version: encryption.version,
    })
    .encrypt(key);
  if (envelope.length > MAX_ENVELOPE_BYTES) throw new Error('invalid submission');
  return envelope;
}
