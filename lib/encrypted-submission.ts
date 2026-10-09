import { CompactEncrypt, importJWK } from 'jose';
import type { CredentialSubmission } from '@onkernel/vault-react/data';

/** The vault's public key from `GET /vaults/{id_or_name}/encryption_key`. Not secret. */
export type VaultEncryptionKey = {
  kid: string;
  jwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
};

/** Clears stay plaintext `null`; every entered value is ciphertext only Kernel can open. */
export type EncryptedFieldEdit = { encrypted_value: string } | { value: null };

export type EncryptedSubmission = {
  version: number;
  fields: Record<string, EncryptedFieldEdit>;
};

export async function encryptSubmission(
  submission: CredentialSubmission,
  key: VaultEncryptionKey,
): Promise<EncryptedSubmission> {
  const publicKey = await importJWK(key.jwk, 'ECDH-ES');
  const fields: Record<string, EncryptedFieldEdit> = {};
  for (const [name, { value }] of Object.entries(submission.fields)) {
    fields[name] = value === null
      ? { value: null }
      : {
          encrypted_value: await new CompactEncrypt(new TextEncoder().encode(value))
            .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', kid: key.kid })
            .encrypt(publicKey),
        };
  }
  return { version: submission.version, fields };
}
