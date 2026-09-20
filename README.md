# Customer-hosted encrypted credential collection

A runnable Next.js example using [`@onkernel/vault-react`](https://www.npmjs.com/package/@onkernel/vault-react). The existing `CredentialForm.onSubmit` boundary encrypts the complete `CredentialSubmission` before sending it to the same-origin backend. Only that backend's collection handler decrypts it, validates it, and forwards plaintext through the existing Kernel item PATCH. No Kernel API or `@onkernel/vault-react` changes are required.

## Run the mock flow

Requires Bun and Node.js 20.9 or newer. Web Crypto requires HTTPS in browsers; localhost works for development.

```sh
cp .env.example .env.local
chmod 600 .env.local
bun install --frozen-lockfile
# Run once: writes a fresh wrapping key directly to the ignored env file, not stdout.
bun -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); const path = ".env.local"; fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace(/^COLLECTION_KEY_WRAPPING_KEY=$/m, "COLLECTION_KEY_WRAPPING_KEY=" + crypto.randomBytes(32).toString("base64")));'
bun run dev
```

In a second terminal:

```sh
bun run create-request
```

Open the printed 15-minute collection link. Mock mode exercises browser encryption, backend decryption, and consumption without calling Kernel. Do not enter real credentials in mock mode. The mock vault is in-memory and resets on restart; collection requests survive in `.data/credential-requests.json`.

The CLI and server must use the same `COLLECTION_KEY_WRAPPING_KEY`: a server-only, base64-encoded 32-byte random key. There is no insecure default, including in mock mode. Restart the server after changing environment variables. Changing this key makes existing requests undecryptable; generate new links or implement key rotation with historical wrapping-key IDs. Old request files without encryption keys are not migrated; generate fresh links.

## Connect a Kernel vault item

1. Set `MOCK_VAULT=false` and `KERNEL_API_KEY` in `.env.local`.
2. Create a credential item in a Kernel vault.
3. Generate a link:

```sh
bun run create-request -- <vault-id-or-name> <item-key>
```

The command retrieves the immutable item ID, creates a fresh P-256 keypair and key ID, wraps the private key, and persists the request. It also generates 32 random bearer bytes, stores only their SHA-256 digest, and prints the raw token once:

```text
https://app.example.com/credentials/collect#token=<43-character-base64url-token>
```

Treat the printed URL as a credential. The fragment is not sent in page requests or referrers. The page sends the token only in an `Authorization: Bearer <token>` header to `/api/credential-requests/current` and clears the fragment after confirmed completion.

## Encryption flow

1. **Create:** `scripts/create-request.ts` generates a separate keypair for every collection request. `PrivateKeyProtector` wraps its PKCS#8 private key before `CollectionRequestStore` saves anything. No plaintext private JWK/PEM is persisted.
2. **Render:** the bearer-authorized GET returns the safe item projection plus `{ keyId, requestId, itemId, version, publicKey }`. The explicit public-key projection includes only `kty`, `crv`, `x`, and `y`; neither wrapped nor unwrapped private-key material is returned.
3. **Encrypt:** `lib/credential-envelope.ts` uses `jose` and browser Web Crypto to produce compact JWE with **ECDH-ES+A256KW / A256GCM**, using P-256. JOSE manages the ephemeral sender key, content-encryption key, key wrapping, nonce, and authentication tag. The entire submission, including non-sensitive edits and null clears, is encrypted. The PATCH body is only the compact JWE, with `Content-Type: application/jose`.
4. **Validate and forward:** `lib/collection-handler.ts` checks the bearer, expiry, revocation, consumption, and exact origin. It retrieves the mapped item's immutable ID, unwraps and decrypts inside the handler path, and validates the authenticated key ID, request ID, item ID, and version. The protected-header version must equal the plaintext submission version and the current item version. Existing field-name/type/required/size validation remains. The SDK PATCH still carries plaintext fields, `expected_item_id`, and the rendered version.
5. **Complete:** after a confirmed valid Kernel response (or an unchanged submission), the store marks the request consumed and clears its wrapped private key in the same file replacement. PATCH returns only a completion marker, not echoed field values. Subsequent reads/writes return `consumed`.

The server pins both JWE algorithms; the client cannot select a weaker algorithm. The protected header is authenticated as JWE additional authenticated data, not encrypted: IDs, version, algorithm identifiers, and the ephemeral public key are visible. The JWE authenticates ciphertext integrity, **not sender identity**; authorization still depends on the bearer and origin checks. Anyone with the public key can construct ciphertext, but cannot submit without a valid bearer.

Limits: 192 KiB streamed HTTP envelope, 128 KiB decrypted UTF-8 JSON, 2 KiB encoded protected header, 32 edited fields, and 16 KiB UTF-8 per value. Compression is not supported. Plaintext JSON PATCHes are rejected.

## Guarantees and non-guarantees

**Protected:** passive capture of the browser-to-collection-endpoint request body by a CDN, load balancer, request logger, generic middleware/APM, or other relay sees ciphertext, not entered values. This assumes those components do not control the served JavaScript/public key or inspect the decrypting process. HTTPS, `no-store`, `no-referrer`, and same-origin enforcement remain necessary.

**Not end-to-end encryption from the application:** the customer-hosted frontend sees entered values. The decrypt-and-forward backend briefly handles plaintext, as does Kernel through the existing API. A compromised frontend, XSS, session replay, malicious key substitution, in-process instrumentation of the handler, or backend compromise can recover values. Code with access to both the wrapping service/key and stored keys can decrypt captured envelopes. This does not protect the backend-to-Kernel plaintext request from instrumentation on that leg; use TLS and exclude it from capture too.

**Not all response data is secret:** the existing safe GET projection intentionally includes displayable non-sensitive saved values (for example, email), field definitions, and status. Those responses are not application-layer encrypted. Sensitive saved values are never returned. Bearer headers, URL fragments, request metadata, and ciphertext lengths also remain outside this confidentiality guarantee. One-time consumption prevents later writes, not disclosure after key compromise; this is not forward secrecy.

No secrets, private keys, plaintext, envelopes, or upstream bodies/errors are logged by the handler. SDK logging is explicitly disabled. Configure platform, proxy, and APM capture separately: do not record authorization headers, collection URLs/fragments, request bodies, DOM input/session replay, handler locals, or outbound Kernel bodies/errors. Generic middleware that only observes HTTP bodies is distinct from an APM agent inspecting handler memory.

## Failure and retry behavior

- Validation failures, conflicts, and upstream failures do **not** consume the request or delete its wrapped key. A same-version retry can succeed if Kernel did not commit. The SDK disables automatic retries.
- If Kernel commits but its response is lost, or consumption persistence fails after the commit, retrying the original envelope sees the advanced version and returns `stale` without another write. The key remains available for authorized reconciliation until explicitly cleared. A changed version alone does not prove this submission succeeded: another writer may have updated the item.
- A lost browser response after durable consumption returns `consumed` on retry. No second write occurs. The example serializes concurrent PATCHes for a token within one handler instance.
- There is no distributed transaction with Kernel and no automatic reconciliation workflow here. In production, persist an in-flight operation/version and outcome, investigate uncertain outcomes before retiring their keys, and use a durable per-request claim shared by all replicas. Never claim exactly-once delivery or automatically consume an uncertain result.

## Storage and production guidance

`LocalPrivateKeyProtector` uses `jose` direct-key **AES-256-GCM** JWE wrapping under the environment key. Its authenticated header binds the private key to the request, immutable item, and key ID. Keep the environment key separate from the data store; do not commit it, expose it in a `NEXT_PUBLIC_` variable, or include it in browser builds/backups with the request file. A file copy alone cannot decrypt private keys without the wrapping key.

`FileCollectionRequestStore` is **local-development-only**. Mutations are serialized within one store instance, and atomic replacement prevents torn files. Neither coordinates separate instances/processes. The CLI and server share that file; avoid creating requests concurrently with submissions. Multiple replicas, cross-process writers, and ephemeral/serverless storage are not supported. In-handler serialization is not a distributed lock.

Before deploying:

1. Replace `PrivateKeyProtector` with a KMS/HSM-backed wrapping service or equivalent, with scoped IAM, audit controls, key rotation/versioning, and separation from stored ciphertext. The decrypting handler remains trusted; wrapping is not protection against that handler's compromise.
2. Replace `CollectionRequestStore` with durable transactional storage and distributed claims. Persist the existing request mapping/lifecycle fields plus `key: { keyId, publicKey, wrappedPrivateKey }`. Atomically record consumption and remove wrapped material; retain recoverable state for uncertain writes.
3. Sweep expired/revoked requests and reconcile uncertain outcomes before applying the retention policy. Clearing the current wrapped key does not securely erase old files, backups, snapshots, or memory. Byte buffers are cleared where practical, but JavaScript strings, parsed submissions, and CryptoKeys cannot be reliably zeroized.
4. Use an exact HTTPS `APP_ORIGIN`, keep the collection route free of third-party scripts, apply CSP and rate limits, and exclude sensitive input/output from logs and telemetry. Store `KERNEL_API_KEY` only on the server.
5. Deliver links through a channel suitable for password-reset links and keep expiry short. Add signed-in user checks to both reads and writes if required by your authorization model. The fragment bearer alone is the example's capability.

## Checks

```sh
bun run typecheck
bun run test
bun run build
```

Tests exercise the actual form-to-handler flow, ciphertext-only browser bodies, exact decrypted SDK payloads, key/envelope/binding tampering, plaintext and size rejection, lifecycle/origin checks, wrapped storage/cleanup, concurrent submissions, and uncertain outcomes.

## License

MIT
