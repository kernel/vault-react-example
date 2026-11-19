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

test('keeps the token when Strict Mode runs the mount effect twice', async () => {
  window.location.href = `https://app.example.com/cards/add#token=${token}`;
  const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ status: 'completed' }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const { StrictMode } = await import('react');

  await act(async () =>
    root.render(
      <StrictMode>
        <CardCapturePage />
      </StrictMode>,
    ),
  );
  await act(settle);

  expect(container.textContent).not.toContain('This link is incomplete');
  expect(container.textContent).toContain('Card added');
  const authorizations = fetchMock.mock.calls.map(([, init]) =>
    new Headers(init?.headers).get('Authorization'),
  );
  expect(authorizations.length).toBeGreaterThan(0);
  expect(new Set(authorizations)).toEqual(new Set([`Bearer ${token}`]));
});

test('switches to a new link opened in the same tab', async () => {
  const second = `s36utp6h7ycc1bpm6pyv1g2q.${'b'.repeat(43)}`;
  window.location.href = `https://app.example.com/cards/add#token=${token}`;
  const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ status: 'completed' }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await act(async () => root.render(<CardCapturePage />));
  await act(settle);
  fetchMock.mockClear();

  await act(async () => {
    window.location.hash = `token=${second}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await act(settle);

  expect(window.location.hash).toBe('');
  expect(fetchMock).toHaveBeenCalled();
  for (const [, init] of fetchMock.mock.calls) {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${second}`);
  }
});

test('going back to an earlier link restores that link', async () => {
  const second = `s36utp6h7ycc1bpm6pyv1g2q.${'b'.repeat(43)}`;
  window.location.href = `https://app.example.com/cards/add#token=${token}`;
  const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ status: 'completed' }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await act(async () => root.render(<CardCapturePage />));
  await act(settle);
  const firstEntry = window.history.state;

  await act(async () => {
    window.location.hash = `token=${second}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await act(settle);
  fetchMock.mockClear();

  await act(async () => {
    window.history.replaceState(firstEntry, '', '/cards/add');
    window.dispatchEvent(new PopStateEvent('popstate', { state: firstEntry }));
  });
  await act(settle);

  expect(fetchMock).toHaveBeenCalled();
  for (const [, init] of fetchMock.mock.calls) {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
  }
});

test('an entry whose link is no longer in memory asks for the link again', async () => {
  window.location.href = `https://app.example.com/cards/add#token=${token}`;
  const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ status: 'completed' }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await act(async () => root.render(<CardCapturePage />));
  await act(settle);

  await act(async () => {
    window.history.replaceState(null, '', '/cards/add');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
  await act(settle);

  expect(container.textContent).toContain('This link is incomplete');
});

test('sends the token to the API origin the server and scripts use', async () => {
  const original = process.env.KERNEL_API_BASE_URL;
  process.env.KERNEL_API_BASE_URL = 'https://api.staging.example';
  try {
    window.location.href = `https://app.example.com/cards/add#token=${token}`;
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ status: 'completed' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await act(async () => root.render(<CardCapturePage />));
    await act(settle);

    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.staging.example/vault/card-captures/current');
  } finally {
    if (original === undefined) delete process.env.KERNEL_API_BASE_URL;
    else process.env.KERNEL_API_BASE_URL = original;
  }
});
