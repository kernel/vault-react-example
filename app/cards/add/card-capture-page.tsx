'use client';

import { useEffect, useRef, useState } from 'react';
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

// entryID names a history entry. It is random, so an entry left by an earlier
// load of this page never matches a link read in this one.
function entryID() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join('');
}

export function CardCapturePage() {
  const [token, setToken] = useState<string | null>();
  // Tokens stay in memory. History entries hold only a random ID, so a token
  // is never written to session history or restored after the page reloads.
  const tokens = useRef(new Map<string, string>());

  useEffect(() => {
    // The token travels in the fragment, so it never reaches a server log or a
    // referrer. Read it, tag the history entry with an ID, and remove the
    // fragment from the address bar. Every entry then shows /cards/add, so
    // going back or forward restores the link from the entry's ID instead.
    // Strict Mode runs this effect twice; the second run finds the first run's
    // ID. KernelCardCapture starts over whenever its token changes.
    const read = () => {
      if (window.location.hash) {
        const next = readCaptureToken(window.location.hash);
        const entry = next ? entryID() : undefined;
        if (entry && next) tokens.current.set(entry, next);
        window.history.replaceState({ ...window.history.state, captureLink: entry }, '', window.location.pathname);
        setToken(next);
        return;
      }
      const entry: unknown = window.history.state?.captureLink;
      setToken((typeof entry === 'string' && tokens.current.get(entry)) || null);
    };
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, []);

  if (token === undefined) return null;
  return (
    <KernelCardCapture
      token={token ?? ''}
      baseUrl={process.env.KERNEL_API_BASE_URL || undefined}
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
