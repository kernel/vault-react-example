import './setup';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CredentialItem, CredentialSubmission } from '@onkernel/vault-react';
import { createCollectionHandler } from '../lib/collection-handler';
import { createCollectionKey } from '../lib/collection-keys';
import { LocalPrivateKeyProtector } from '../lib/private-key-protector';
import { FileCollectionRequestStore, type CollectionRequest } from '../lib/request-store';
import { collectionTokenDigest } from '../lib/server-token';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CollectionPage } = await import('../app/credentials/collect/collection-page');
const token = 'a'.repeat(43);
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalFetch: typeof fetch;
let directory: string;

function item(): CredentialItem {
  return {
    id: 'vi_example',
    type: 'credential',
    version: 1,
    spec: {
      fields: [
        { name: 'password', type: 'password', required: true, sensitive: true },
        { name: 'note', type: 'text', required: false, sensitive: false },
      ],
    },
    state: {
      status: 'pending_collection',
      fields: { password: { has_value: false }, note: { has_value: false } },
    },
  };
}

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  directory = await mkdtemp(join(tmpdir(), 'collection-page-'));
  window.location.href = `https://app.example.com/credentials/collect#token=${token}`;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
  await rm(directory, { recursive: true, force: true });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test('encrypts the complete browser submission and forwards exact values through the handler', async () => {
  const origin = 'https://app.example.com';
  const protector = new LocalPrivateKeyProtector(randomBytes(32).toString('base64'));
  const store = new FileCollectionRequestStore(join(directory, 'requests.json'));
  const mapping: CollectionRequest = {
    id: 'request-1', tokenDigest: collectionTokenDigest(token), vaultId: 'vault',
    itemKey: 'credential', itemId: item().id,
    key: await createCollectionKey('request-1', item().id, protector),
    expiresAt: Date.now() + 60_000, consumedAt: null, revokedAt: null,
  };
  await store.save(mapping);
  const update = mock(async (_mapping: CollectionRequest, _submission: CredentialSubmission) => ({ ...item(), version: 2 }));
  const handler = createCollectionHandler({
    appOrigin: origin, store, protector, vault: { retrieve: async () => item(), update },
  });
  const fetcher = Object.assign(
    mock(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (init?.method === 'PATCH') headers.set('Origin', origin);
      return handler(new Request(new URL(String(input), origin), { ...init, headers }));
    }),
    { preconnect() {} },
  );
  globalThis.fetch = fetcher;
  await act(async () => {
    root.render(<CollectionPage />);
  });
  for (let i = 0; i < 100 && !container.querySelector('form'); i++) {
    await act(settle);
  }

  expect(fetcher.mock.calls[0][0]).toBe('/api/credential-requests/current');
  const read = fetcher.mock.calls[0][1];
  expect(read?.credentials).toBe('omit');
  expect(read?.cache).toBe('no-store');
  expect(new Headers(read?.headers).get('Authorization')).toBe(`Bearer ${token}`);
  expect(String(fetcher.mock.calls[0][0])).not.toContain(token);

  const password = ' synthetic password é 🔒 ';
  const note = 'synthetic non-sensitive note';
  container.querySelector<HTMLInputElement>('input[name="password"]')!.value = password;
  container.querySelector<HTMLInputElement>('input[name="note"]')!.value = note;
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  for (let i = 0; i < 100 && window.location.hash; i++) {
    await act(settle);
  }

  const submission = fetcher.mock.calls[1];
  expect(submission[0]).toBe('/api/credential-requests/current');
  expect(submission[1]?.method).toBe('PATCH');
  expect(submission[1]?.credentials).toBe('omit');
  expect(submission[1]?.cache).toBe('no-store');
  expect(new Headers(submission[1]?.headers).get('Authorization')).toBe(`Bearer ${token}`);
  expect(new Headers(submission[1]?.headers).get('Content-Type')).toBe('application/jose');
  const body = String(submission[1]?.body);
  expect(body.split('.')).toHaveLength(5);
  for (const value of [token, password, note, 'password', 'fields']) expect(body).not.toContain(value);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][1]).toEqual({
    version: 1, fields: { password: { value: password }, note: { value: note } },
  });
  const consumed = await store.findByTokenDigest(mapping.tokenDigest);
  expect(consumed?.consumedAt).not.toBeNull();
  expect(consumed?.key.wrappedPrivateKey).toBeNull();
  expect(window.location.pathname).toBe('/credentials/collect');
  expect(window.location.hash).toBe('');
});
