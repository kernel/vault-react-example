import { CompactEncrypt, compactDecrypt } from 'jose';
import type { KeyBinding } from './credential-envelope';

/** Replace this boundary with a KMS/HSM-backed implementation in production. */
export interface PrivateKeyProtector {
  wrap(privateKey: Uint8Array, binding: KeyBinding): Promise<string>;
  unwrap(wrappedKey: string, binding: KeyBinding): Promise<Uint8Array>;
}

const type = 'collection-private-key+jwe';

export class LocalPrivateKeyProtector implements PrivateKeyProtector {
  private readonly key: Uint8Array;

  constructor(encodedKey: string) {
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedKey) {
      throw new Error('COLLECTION_KEY_WRAPPING_KEY must be 32 random bytes encoded as base64');
    }
    this.key = key;
  }

  async wrap(privateKey: Uint8Array, binding: KeyBinding) {
    return new CompactEncrypt(privateKey)
      .setProtectedHeader({
        alg: 'dir', enc: 'A256GCM', typ: type,
        kid: binding.keyId, request_id: binding.requestId, item_id: binding.itemId,
      })
      .encrypt(this.key);
  }

  async unwrap(wrappedKey: string, binding: KeyBinding) {
    const { plaintext, protectedHeader } = await compactDecrypt(wrappedKey, this.key, {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    if (
      protectedHeader.typ !== type || protectedHeader.kid !== binding.keyId ||
      protectedHeader.request_id !== binding.requestId || protectedHeader.item_id !== binding.itemId
    ) {
      plaintext.fill(0);
      throw new Error('invalid wrapped key');
    }
    return plaintext;
  }
}

export function localPrivateKeyProtector() {
  const key = process.env.COLLECTION_KEY_WRAPPING_KEY;
  if (!key) throw new Error('COLLECTION_KEY_WRAPPING_KEY is required');
  return new LocalPrivateKeyProtector(key);
}
