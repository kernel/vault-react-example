# Customer-hosted credential collection

A runnable Next.js example for collecting credentials with [`@onkernel/vault-react`](https://www.npmjs.com/package/@onkernel/vault-react). The browser renders Kernel's unstyled credential form while a same-origin backend keeps the Kernel API key private and maps one-time bearer capabilities to vault items.

Entered values are encrypted in the browser to the vault's public key, sent to this backend still encrypted, and forwarded to Kernel as `encrypted_value`. Only Kernel can decrypt them, so plaintext never appears in this app's backend, proxies, or request logs. See [Encrypted values](#encrypted-values).

## Run the mock flow

Requires Bun and Node.js 20.9 or newer.

```sh
cp .env.example .env.local
bun install
bun run dev
```

In a second terminal, create a 15-minute collection link:

```sh
bun run create-request
```

Open the printed URL. Mock mode exercises the complete browser/backend flow without calling Kernel. Do not enter real credentials in mock mode.

## Connect a Kernel vault item

1. Set `MOCK_VAULT=false` and `KERNEL_API_KEY` in `.env.local`.
2. Create a credential item in a Kernel vault.
3. Generate a link for that item:

```sh
bun run create-request -- <vault-id-or-name> <item-key>
```

The command retrieves the item's immutable ID, generates 32 random bytes, stores only the SHA-256 token digest, and prints the raw token once in this form:

```text
https://app.example.com/credentials/collect#token=<43-character-base64url-token>
```

The fragment is not sent in page requests or referrers. The page sends it only in an `Authorization: Bearer <token>` header to the same-origin `/api/credential-requests/current` endpoint.

## How it is organized

- `app/credentials/collect` reads and clears the fragment capability, renders `CredentialForm`, and encrypts the submission before sending it.
- `app/api/credential-requests/current` serves safe item data with the vault's public key and accepts versioned, encrypted field edits.
- `lib/encrypted-submission.ts` turns a `CredentialForm` submission into `encrypted_value` fields with [`jose`](https://github.com/panva/jose).
- `lib/collection-handler.ts` validates the bearer, origin, target, item ID, version, field names, ciphertext shape, and body size.
- `lib/vault-client.ts` contains real and mock vault adapters. Only the real adapter receives `KERNEL_API_KEY`. The mock adapter generates its own key pair and decrypts like Kernel does.
- `lib/request-store.ts` defines the durable `CollectionRequestStore` boundary.
- `scripts/create-request.ts` creates a short-lived link without persisting the raw token.

Successful submissions mark the mapping consumed. Kernel writes include both the rendered version and immutable item ID, so a stale form or a deleted-and-recreated key cannot redirect a write.

## Encrypted values

1. `GET /api/credential-requests/current` returns `{ item, encryption_key }`. The backend gets the key from `kernel.vaults.retrieveEncryptionKey(vaultId)` (`GET /vaults/{id_or_name}/encryption_key`). Each vault has its own P-256 key; it is public and stable for the vault's lifetime.
2. On submit, the page encrypts every entered value as a compact JWE (`alg: ECDH-ES`, `enc: A256GCM`, the vault's `kid` in the header). Clearing an optional field stays `{ "value": null }`.
3. The backend validates the request and passes each field through unchanged:

```json
{ "version": 3, "fields": { "password": { "encrypted_value": "eyJhbGciOiJFQ0RILUVTIi..." } } }
```

4. `kernel.vaults.items.update` sends the ciphertext to Kernel, which decrypts and validates it exactly like `value`.

The backend rejects plaintext `value` strings, so a misconfigured page cannot silently fall back to sending plaintext. Kernel rejects ciphertext encrypted for a different vault with `400 encryption_key_mismatch`, which this example reports as `invalid`.

Requires `@onkernel/sdk` 0.122.0 or newer. If your backend already holds plaintext (for example, a server-to-server integration), send `value` instead; `encrypted_value` is only for values encrypted in a browser you control.

## Use a production store

`FileCollectionRequestStore` is intentionally local-only. Its atomic file replacement prevents torn files, but it does not coordinate multiple processes and most serverless filesystems are ephemeral.

Before deployment, implement `CollectionRequestStore` with your database and replace the construction in `lib/runtime.ts`. Persist:

```ts
{
  id,
  tokenDigest,
  vaultId,
  itemKey,
  itemId,
  expiresAt,
  consumedAt,
  revokedAt,
}
```

Add any signed-in application user ID needed by your authorization model. Verify that user in addition to the bearer on every read and write. Make consumption and revocation atomic in the database.

## Deployment checklist

1. Set `APP_ORIGIN` to the exact HTTPS origin serving the page.
2. Set `MOCK_VAULT=false` and provide `KERNEL_API_KEY` only to the server runtime.
3. Replace the file store with a durable database implementation.
4. Deliver links through a channel suitable for password-reset links and keep expiry short.
5. Exclude URLs, fragments, authorization headers, request bodies, credentials, and upstream errors from logs, analytics, traces, and session replay.

The backend receives only ciphertext, but the page's JavaScript sees raw entered values before encrypting them. It is trusted application code, not an isolated Kernel collector. A compromised page or a script injected into it can read values before encryption. Keep the collection route free of third-party scripts, serve it over HTTPS (WebCrypto requires a secure context), and preserve the response's `no-store` and `no-referrer` policies.

## Checks

```sh
bun run typecheck
bun run test
bun run build
```

## License

MIT
