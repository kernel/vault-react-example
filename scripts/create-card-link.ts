import Kernel from '@onkernel/sdk';

// Creates a Kernel wallet if needed, adds a payment method, and prints a link
// to this app's card capture page. Card capture always talks to Kernel, so
// there is no mock mode.
const [vaultArg, walletArg = 'card-wallet'] = process.argv.slice(2);
if (!vaultArg) throw new Error('usage: bun run create-card-link -- <vault-name> [wallet-key]');

const appOrigin = new URL(required('APP_ORIGIN')).origin;
const kernel = new Kernel({
  apiKey: required('KERNEL_API_KEY'),
  maxRetries: 0,
  ...(process.env.KERNEL_API_BASE_URL ? { baseURL: process.env.KERNEL_API_BASE_URL } : {}),
});

const vault = await kernel.vaults.upsert({ name: vaultArg });
await kernel.vaults.items.upsert(walletArg, {
  id_or_name: vault.id,
  type: 'wallet',
  spec: { provider: 'kernel' },
});
const added = await kernel.vaults.items.performOperation(walletArg, {
  id_or_name: vault.id,
  type: 'add_payment_method',
});
const token = added.type === 'add_payment_method' ? added.payment_method.action?.capture_token : undefined;
if (!token) throw new Error('Kernel returned no capture token; the wallet must use provider "kernel"');

const url = new URL('/cards/add', appOrigin);
url.hash = `token=${token}`;
process.stdout.write(`${url.toString()}\n`);

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
