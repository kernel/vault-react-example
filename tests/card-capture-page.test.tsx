import './setup';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CardCapturePage } = await import('../app/cards/add/card-capture-page');
const token = `s36utp6h7ycc1bpm6pyv1g2p.${'a'.repeat(43)}`;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
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

test('sends the fragment token to Kernel and clears it from the address bar', async () => {
  window.location.href = `https://app.example.com/cards/add#token=${token}`;
  const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ status: 'completed' }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await act(async () => root.render(<CardCapturePage />));
  await act(settle);

  expect(window.location.hash).toBe('');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [input, init] = fetchMock.mock.calls[0];
  expect(String(input)).toBe('https://api.onkernel.com/vault/card-captures/current');
  expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
  expect(container.textContent).toContain('Card added');
});

test('explains an incomplete link without calling Kernel', async () => {
  window.location.href = 'https://app.example.com/cards/add#token=not-a-token';
  const fetchMock = mock(async () => Response.json({}));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await act(async () => root.render(<CardCapturePage />));
  await act(settle);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.textContent).toContain('This link is incomplete');
});
