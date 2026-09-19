import Kernel, { APIError, ConflictError } from '@onkernel/sdk';
import type { CredentialVaultItem, VaultItem } from '@onkernel/sdk/resources/vaults/items';
import type { CredentialItem, CredentialSubmission } from '@onkernel/vault-react/data';
import type { CollectionRequest } from './request-store';

export class VaultConflictError extends Error {}
export class VaultInvalidRequestError extends Error {}

export interface CredentialVaultClient {
  retrieve(request: CollectionRequest): Promise<unknown>;
  update(request: CollectionRequest, submission: CredentialSubmission): Promise<unknown>;
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

  async update(request: CollectionRequest, submission: CredentialSubmission) {
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

export class MockCredentialVaultClient implements CredentialVaultClient {
  private readonly items = new Map<string, CredentialItem>();

  async retrieve(request: CollectionRequest) {
    const item = this.items.get(request.itemId) ?? this.createItem(request.itemId);
    this.items.set(request.itemId, item);
    return structuredClone(item);
  }

  async update(request: CollectionRequest, submission: CredentialSubmission) {
    const item = this.items.get(request.itemId) ?? this.createItem(request.itemId);
    if (item.version !== submission.version) throw new VaultConflictError();
    for (const [name, { value }] of Object.entries(submission.fields)) {
      const field = item.spec.fields.find((candidate) => candidate.name === name);
      if (!field) throw new VaultInvalidRequestError();
      item.state.fields[name] = value === null
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
