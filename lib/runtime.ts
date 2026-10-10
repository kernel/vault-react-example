import { join } from 'node:path';
import { createCollectionHandler } from './collection-handler';
import { FileCollectionRequestStore } from './request-store';
import { KernelCredentialVaultClient, MockCredentialVaultClient } from './vault-client';

let handlers: { plaintext: CollectionHandler; encrypted: CollectionHandler } | undefined;
type CollectionHandler = ReturnType<typeof createCollectionHandler>;

/** `encrypted` serves the encrypted-values example; both share one store and vault client. */
export function getCollectionHandler(encrypted = false) {
  handlers ??= create();
  return encrypted ? handlers.encrypted : handlers.plaintext;
}

function create() {
  const appOrigin = required('APP_ORIGIN');
  const storePath = join(process.cwd(), '.data', 'credential-requests.json');
  const store = new FileCollectionRequestStore(storePath);
  const vault = process.env.MOCK_VAULT === 'true'
    ? new MockCredentialVaultClient()
    : new KernelCredentialVaultClient(
        required('KERNEL_API_KEY'),
        process.env.KERNEL_API_BASE_URL,
      );
  return {
    plaintext: createCollectionHandler({ appOrigin, store, vault }),
    encrypted: createCollectionHandler({ appOrigin, store, vault, encrypted: true }),
  };
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
