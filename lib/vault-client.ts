import Kernel, { APIError, ConflictError } from '@onkernel/sdk';
import type { CredentialVaultItem, VaultItem } from '@onkernel/sdk/resources/vaults/items';
import type { CredentialItem } from '@onkernel/vault-react/data';
import { compactDecrypt, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import type { EncryptedSubmission, VaultEncryptionKey } from './encrypted-submission';
import type { CollectionRequest } from './request-store';

export class VaultConflictError extends Error {}
export class VaultInvalidRequestError extends Error {}

export interface CredentialVaultClient {
  retrieve(request: CollectionRequest): Promise<unknown>;
  encryptionKey(request: CollectionRequest): Promise<VaultEncryptionKey>;
  update(request: CollectionRequest, submission: EncryptedSubmission): Promise<unknown>;
}

function credentialItem(item: VaultItem): CredentialVaultItem {
  if (item.type !== 'credential') throw new Error('unexpected vault item type');
  return item;
}

export class KernelCredentialVaultClient implements CredentialVaultClient {
  private readonly kernel: Kernel;
  private readonly requestOptions = {
    fetchOptions: { cache: 'no-store', redirect: 'error' },
  } as const;

  constructor(apiKey: string, baseURL?: string) {
    this.kernel = new Kernel({ apiKey, maxRetries: 0, ...(baseURL ? { baseURL } : {}) });
  }

  async retrieve(request: CollectionRequest) {
    return credentialItem(
      await this.kernel.vaults.items.retrieve(
        request.itemKey,
        { id_or_name: request.vaultId },
        this.requestOptions,
      ),
    );
  }

  async encryptionKey(request: CollectionRequest): Promise<VaultEncryptionKey> {
    const { kid, jwk } = await this.kernel.vaults.retrieveEncryptionKey(request.vaultId, this.requestOptions);
    return { kid, jwk };
  }

  async update(request: CollectionRequest, submission: EncryptedSubmission) {
    try {
      return credentialItem(
        await this.kernel.vaults.items.update(
          request.itemKey,
          {
            id_or_name: request.vaultId,
            type: 'credential',
            expected_item_id: request.itemId,
            version: submission.version,
            spec: { fields: submission.fields },
          },
          this.requestOptions,
        ),
      );
    } catch (error) {
      if (error instanceof ConflictError) throw new VaultConflictError();
      if (error instanceof APIError && error.status === 400) throw new VaultInvalidRequestError();
      throw error;
    }
  }
}

/** Stands in for Kernel, including decrypting `encrypted_value` with the vault's private key. */
export class MockCredentialVaultClient implements CredentialVaultClient {
  private readonly items = new Map<string, CredentialItem>();
  private key?: Promise<{ public: VaultEncryptionKey; privateKey: CryptoKey }>;

  async retrieve(request: CollectionRequest) {
    const item = this.items.get(request.itemId) ?? this.createItem(request.itemId);
    this.items.set(request.itemId, item);
    return structuredClone(item);
  }

  async encryptionKey() {
    return (await this.keyPair()).public;
  }

  async update(request: CollectionRequest, submission: EncryptedSubmission) {
    const item = this.items.get(request.itemId) ?? this.createItem(request.itemId);
    if (item.version !== submission.version) throw new VaultConflictError();
    for (const [name, edit] of Object.entries(submission.fields)) {
      const field = item.spec.fields.find((candidate) => candidate.name === name);
      if (!field) throw new VaultInvalidRequestError();
      const value = 'encrypted_value' in edit ? await this.decrypt(edit.encrypted_value) : edit.value;
      item.state.fields[name] = value === null || value === ''
        ? { has_value: false }
        : field.sensitive
          ? { has_value: true }
          : { has_value: true, value };
    }
    item.version += 1;
    item.state.status = 'ready';
    this.items.set(request.itemId, item);
    return structuredClone(item);
  }

  private async decrypt(encrypted: string) {
    const { privateKey, public: key } = await this.keyPair();
    try {
      const { plaintext, protectedHeader } = await compactDecrypt(encrypted, privateKey, {
        keyManagementAlgorithms: ['ECDH-ES'],
        contentEncryptionAlgorithms: ['A256GCM'],
      });
      if (protectedHeader.kid !== key.kid) throw new Error('kid mismatch');
      return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    } catch {
      throw new VaultInvalidRequestError();
    }
  }

  private keyPair() {
    this.key ??= (async () => {
      const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256' });
      const { x, y } = await exportJWK(publicKey);
      return { privateKey, public: { kid: 'vtk_mock', jwk: { kty: 'EC', crv: 'P-256', x: x!, y: y! } } };
    })();
    return this.key;
  }

  private createItem(id: string): CredentialItem {
    return {
      id,
      type: 'credential',
      version: 1,
      spec: {
        description: 'Enter the credentials requested by the application.',
        fields: [
          { name: 'email', type: 'email', required: true, sensitive: false },
          { name: 'password', type: 'password', required: true, sensitive: true },
        ],
      },
      state: {
        status: 'pending_collection',
        fields: { email: { has_value: false }, password: { has_value: false } },
      },
    };
  }
}
