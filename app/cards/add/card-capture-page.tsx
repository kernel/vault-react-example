'use client';

import { useEffect, useState } from 'react';
import { KernelCardCapture } from '@onkernel/vault-react';
import { readCaptureToken } from '@/lib/capture-token';

// Kernel stores a card with VGS or Evervault, depending on the organization.
// Both render in the provider's own iframes, which page CSS can't reach:
// fieldCss styles the VGS inputs and evervaultTheme styles Evervault's. The
// component uses whichever matches the card vault.
const fieldCss = {
  'font-family': 'ui-sans-serif, system-ui, sans-serif',
  'font-size': '16px',
  color: '#111827',
  '&::placeholder': { color: '#9ca3af' },
  '&.invalid.touched': { color: '#b91c1c' },
};

const evervaultTheme = {
  styles: {
    body: { fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111827' },
    '[ev-component=card]': { gap: 20 },
    label: { display: 'block', marginBottom: 8, fontSize: 16, fontWeight: 600 },
    input: {
      height: 42,
      padding: '0 12px',
      border: '1px solid #9ca3af',
      borderRadius: 8,
      background: '#ffffff',
      color: '#111827',
      fontSize: 16,
      '&::placeholder': { color: '#9ca3af' },
      '&:focus': { borderColor: '#111827', boxShadow: '0 0 0 3px rgb(17 24 39 / 12%)', outline: 'none' },
    },
    '.field[ev-valid=false] input': { borderColor: '#b91c1c' },
    '.error': { marginTop: 6, fontSize: 14, color: '#b91c1c' },
  },
};

const labels = {
  title: 'Add a payment card',
  description:
    'Your assistant uses this card for purchases you approve. Card details go straight to a secure card vault; we never see your card number.',
  completeTitle: 'Card added',
  completeDescription: 'Your assistant can now request purchases with this card.',
  number: 'Card number',
  expiry: 'Expiry',
  expirationPlaceholder: 'MM / YY',
  cvc: 'CVC',
  email: 'Email',
  emailHint: 'The card network may use it to verify you.',
  submit: 'Save card',
  submitting: 'Saving…',
  retry: 'Try again',
  checkAgain: 'Check again',
  missingToken: 'This link is incomplete. Open the full link you were sent.',
};

export function CardCapturePage() {
  const [token, setToken] = useState<string | null>();

  useEffect(() => {
    // The token travels in the fragment, so it never reaches a server log or a
    // referrer. Read it, then remove it from the address bar. An empty fragment
    // keeps the token already read: Strict Mode runs this effect twice, and the
    // second run sees the fragment the first one cleared. Opening another link
    // in this tab changes only the fragment, so read again on hashchange;
    // KernelCardCapture starts over when its token changes.
    const read = () => {
      const hash = window.location.hash;
      setToken((current) => (hash ? readCaptureToken(hash) : (current ?? null)));
      if (hash) window.history.replaceState(null, '', window.location.pathname);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  if (token === undefined) return null;
  return (
    <KernelCardCapture
      token={token ?? ''}
      baseUrl={process.env.NEXT_PUBLIC_KERNEL_API_BASE_URL}
      className="customer-card-capture"
      fieldCss={fieldCss}
      evervaultTheme={evervaultTheme}
      labels={labels}
      onComplete={() => {
        // Confirm the payment method is active from your backend before
        // treating the card as ready.
      }}
    />
  );
}
