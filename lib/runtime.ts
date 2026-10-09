import { join } from 'node:path';
import { createCollectionHandler } from './collection-handler';
import { FileCollectionRequestStore } from './request-store';
import { KernelCredentialVaultClient, MockCredentialVaultClient } from './vault-client';

let handler: ReturnType<typeof createCollectionHandler> | undefined;

export function getCollectionHandler() {
  if (handler) return handler;
  const appOrigin = required('APP_ORIGIN');
  const storePath = join(process.cwd(), '.data', 'credential-requests.json');
  const store = new FileCollectionRequestStore(storePath);
  const vault = process.env.MOCK_VAULT === 'true'
    ? new MockCredentialVaultClient()
    : new KernelCredentialVaultClient(
        required('KERNEL_API_KEY'),
        process.env.KERNEL_API_BASE_URL,
      );
  handler = createCollectionHandler({ appOrigin, store, vault });
  return handler;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
