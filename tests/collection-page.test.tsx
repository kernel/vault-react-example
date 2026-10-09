import './setup';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { CredentialItem } from '@onkernel/vault-react';
import { compactDecrypt, exportJWK, generateKeyPair } from 'jose';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CollectionPage } = await import('../app/credentials/collect/collection-page');
const token = 'a'.repeat(43);
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalFetch: typeof fetch;

function item(): CredentialItem {
  return {
    id: 'vi_example',
    type: 'credential',
    version: 1,
    spec: {
      fields: [{ name: 'password', type: 'password', required: true, sensitive: true }],
    },
    state: { status: 'pending_collection', fields: { password: { has_value: false } } },
  };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  window.location.href = `https://app.example.com/credentials/collect#token=${token}`;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('keeps the capability in the fragment and sends only ciphertext', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256' });
  const { x, y } = await exportJWK(publicKey);
  const encryption_key = { kid: 'vtk_example', jwk: { kty: 'EC', crv: 'P-256', x, y } };
  const fetcher = Object.assign(
    mock(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ item: item(), encryption_key }),
    ),
    { preconnect() {} },
  );
  globalThis.fetch = fetcher;
  await act(async () => root.render(<CollectionPage />));
  await act(async () => {
    await settle();
    await settle();
  });

  expect(fetcher.mock.calls[0][0]).toBe('/api/credential-requests/current');
  const read = fetcher.mock.calls[0][1];
  expect(read?.credentials).toBe('omit');
  expect(new Headers(read?.headers).get('Authorization')).toBe(`Bearer ${token}`);
  expect(String(fetcher.mock.calls[0][0])).not.toContain(token);

  container.querySelector<HTMLInputElement>('input[name="password"]')!.value = 'replacement';
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    // Encryption runs on WebCrypto, so wait for the PATCH rather than a single tick.
    for (let i = 0; i < 100 && fetcher.mock.calls.length < 2; i++) await settle();
    await settle();
  });

  const submission = fetcher.mock.calls[1];
  expect(submission[0]).toBe('/api/credential-requests/current');
  expect(submission[1]?.method).toBe('PATCH');
  expect(new Headers(submission[1]?.headers).get('Authorization')).toBe(`Bearer ${token}`);
  const body = String(submission[1]?.body);
  expect(body).not.toContain(token);
  expect(body).not.toContain('replacement');
  const sent = JSON.parse(body);
  expect(sent.version).toBe(1);
  const { plaintext, protectedHeader } = await compactDecrypt(sent.fields.password.encrypted_value, privateKey);
  expect(new TextDecoder().decode(plaintext)).toBe('replacement');
  expect(protectedHeader).toMatchObject({ alg: 'ECDH-ES', enc: 'A256GCM', kid: 'vtk_example' });
  expect(window.location.pathname).toBe('/credentials/collect');
  expect(window.location.hash).toBe('');
});
