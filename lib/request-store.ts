import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CollectionKey } from './collection-keys';

export type CollectionRequest = {
  id: string;
  tokenDigest: string;
  vaultId: string;
  itemKey: string;
  itemId: string;
  key: CollectionKey;
  expiresAt: number;
  consumedAt: number | null;
  revokedAt: number | null;
};

export interface CollectionRequestStore {
  findByTokenDigest(tokenDigest: string): Promise<CollectionRequest | null>;
  save(request: CollectionRequest): Promise<void>;
  markConsumed(tokenDigest: string, consumedAt: number): Promise<void>;
}

type StoreData = { requests: CollectionRequest[] };

/** Local development only. Implement CollectionRequestStore with your database in production. */
export class FileCollectionRequestStore implements CollectionRequestStore {
  private pendingMutation = Promise.resolve();

  constructor(private readonly path: string) {}

  async findByTokenDigest(tokenDigest: string) {
    return (await this.read()).requests.find((request) => request.tokenDigest === tokenDigest) ?? null;
  }

  async save(request: CollectionRequest) {
    return this.mutate((data) => {
      if (data.requests.some(({ id, tokenDigest }) => id === request.id || tokenDigest === request.tokenDigest)) {
        throw new Error('collection request already exists');
      }
      data.requests.push(request);
    });
  }

  async markConsumed(tokenDigest: string, consumedAt: number) {
    return this.mutate((data) => {
      const request = data.requests.find((candidate) => candidate.tokenDigest === tokenDigest);
      if (!request) throw new Error('collection request not found');
      request.consumedAt ??= consumedAt;
      request.key.wrappedPrivateKey = null;
    });
  }

  private mutate(update: (data: StoreData) => void) {
    const mutation = this.pendingMutation.then(async () => {
      const data = await this.read();
      update(data);
      await this.write(data);
    });
    // A failed write must not block later reconciliation attempts.
    this.pendingMutation = mutation.catch(() => {});
    return mutation;
  }

  private async read(): Promise<StoreData> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as StoreData).requests)) {
        throw new Error('invalid collection request store');
      }
      return parsed as StoreData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { requests: [] };
      throw error;
    }
  }

  private async write(data: StoreData) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
  }
}
