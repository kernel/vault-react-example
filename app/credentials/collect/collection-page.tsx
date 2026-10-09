'use client';

import { useEffect, useState } from 'react';
import {
  CredentialForm,
  CredentialFormError,
  safeCredentialItem,
  type CollectionErrorCode,
  type CredentialItem,
} from '@onkernel/vault-react';
import { readCollectionToken } from '@/lib/collection-token';

const endpoint = '/api/credential-requests/current';
const errorCodes = new Set<CollectionErrorCode>([
  'stale',
  'expired',
  'consumed',
  'unavailable',
  'invalid',
]);

async function responseError(response: Response, fallback: CollectionErrorCode) {
  const body: unknown = await response.json().catch(() => null);
  const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  return typeof code === 'string' && errorCodes.has(code as CollectionErrorCode)
    ? (code as CollectionErrorCode)
    : fallback;
}

export function CollectionPage() {
  const [token, setToken] = useState<string | null>();

  useEffect(() => {
    setToken(readCollectionToken(window.location.hash));
    const reload = () => window.location.reload();
    window.addEventListener('hashchange', reload);
    return () => window.removeEventListener('hashchange', reload);
  }, []);

  if (token === undefined) return null;
  if (!token) return <Message>collection link unavailable.</Message>;
  return <RequestForm token={token} />;
}

function RequestForm({ token }: { token: string }) {
  const [item, setItem] = useState<CredentialItem>();
  const [failure, setFailure] = useState<CollectionErrorCode>();
  const authorization = `Bearer ${token}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, {
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: authorization },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new CredentialFormError(await responseError(response, 'unavailable'));
        const safe = safeCredentialItem(await response.json());
        if (!controller.signal.aborted) setItem(safe);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFailure(error instanceof CredentialFormError ? error.code : 'unavailable');
        }
      });
    return () => controller.abort();
  }, [authorization]);

  if (failure) {
    const messages: Partial<Record<CollectionErrorCode, string>> = {
      expired: 'this collection link expired. request a new link.',
      consumed: 'this collection was already completed.',
    };
    return <Message>{messages[failure] ?? 'collection unavailable. request a new link.'}</Message>;
  }
  if (!item) return <p role="status">loading credential fields…</p>;

  return (
    <CredentialForm
      className="customer-credential-form"
      item={item}
      submitLabel="Save credentials"
      onSubmit={async (submission) => {
        const response = await fetch(endpoint, {
          method: 'PATCH',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Authorization: authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify(submission),
        });
        if (!response.ok) {
          throw new CredentialFormError(await responseError(response, 'unavailable'));
        }
        window.history.replaceState(null, '', window.location.pathname);
      }}
    />
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p role="alert">{children}</p>;
}
