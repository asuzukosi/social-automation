#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Generate the receiving wallets for the x402 paid API.
 *
 * x402 settles in USDC, and the two networks worth taking payment on today are
 * Solana (sub-second finality, fees around $0.00025) and Base (the network the
 * Coinbase facilitator and most agent tooling default to). They use different
 * curves and address formats, so this mints one keypair for each:
 *
 *   Solana  ed25519,   address = base58(public key)
 *   EVM     secp256k1, address = 0x + last 20 bytes of keccak256(public key)
 *
 * Keys are generated locally with @noble/curves and viem. Nothing is sent
 * anywhere, and the private keys are written to a single 0600 file that
 * .gitignore already excludes. The addresses are printed; the keys are not, so
 * they never end up in a terminal scrollback or a CI log.
 *
 * Usage:
 *   node scripts/create-x402-wallets.mjs                    # create, refuse to overwrite
 *   node scripts/create-x402-wallets.mjs --force            # replace existing keys
 *   node scripts/create-x402-wallets.mjs --show             # print addresses from the file
 *   node scripts/create-x402-wallets.mjs --out <path>       # somewhere other than the default
 *   node scripts/create-x402-wallets.mjs --role buyer ...   # a spending wallet instead
 *
 * A keypair is a keypair; `--role` only changes what the report tells you to do
 * with it.
 *
 *   receiver (default)  the addresses the paid API is paid to. They are public
 *                       information and go in X402_PAY_TO_ADDRESS (Base) and
 *                       X402_PAY_TO_ADDRESS_SOLANA on the deployment. The private
 *                       keys are needed only to move funds out, so they never
 *                       have to be deployed anywhere at all.
 *   buyer               a wallet that pays for calls. Its private key has to be
 *                       reachable by whatever does the paying, so keep the
 *                       balance small and treat it as disposable.
 *
 * by nichxbt
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const ROLE = flag('role', 'receiver');
if (ROLE !== 'receiver' && ROLE !== 'buyer') {
  console.error(`❌ unknown --role ${ROLE}. Use "receiver" or "buyer".`);
  process.exit(1);
}
const OUT = path.resolve(ROOT, flag('out', ROLE === 'buyer' ? '.x402-buyer.json' : '.x402-wallets.json'));

/** USDC mints/contracts the receiving addresses will hold. */
const ASSETS = {
  solana: {
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    label: 'Solana mainnet',
    usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    explorer: (address) => `https://solscan.io/account/${address}`,
  },
  base: {
    network: 'eip155:8453',
    label: 'Base mainnet',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorer: (address) => `https://basescan.org/address/${address}`,
  },
};

/**
 * Mint a Solana keypair.
 *
 * The secret is stored the way every Solana tool expects it: the 64-byte
 * seed-then-public-key concatenation, base58 for Phantom/Solflare import and as
 * a JSON byte array for `solana-keygen` and the CLI.
 */
function createSolanaWallet() {
  const seed = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(seed);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(publicKey, 32);
  return {
    address: base58.encode(publicKey),
    secretKeyBase58: base58.encode(secret),
    secretKeyBytes: Array.from(secret),
  };
}

/** Mint an EVM keypair. The same address receives on Base and every other EVM chain. */
function createEvmWallet() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey };
}

function readWallets() {
  if (!fs.existsSync(OUT)) return null;
  return JSON.parse(fs.readFileSync(OUT, 'utf8'));
}

function report(wallets) {
  const role = wallets.role || 'receiver';
  const rows = [
    ['Solana', wallets.solana.address, ASSETS.solana],
    ['Base / EVM', wallets.evm.address, ASSETS.base],
  ];
  console.log(`\nx402 ${role === 'buyer' ? 'buyer (spending)' : 'receiving'} addresses\n`);
  for (const [label, address, asset] of rows) {
    console.log(`  ${label}`);
    console.log(`    address   ${address}`);
    console.log(`    network   ${asset.network} (${asset.label})`);
    console.log(`    fund with USDC ${asset.usdc}`);
    console.log(`    explorer  ${asset.explorer(address)}`);
    console.log('');
  }

  if (role === 'buyer') {
    console.log('Fund with USDC only. The facilitator pays the network fee on both');
    console.log('chains, so this wallet needs no SOL and no ETH.\n');
    console.log('The payer reads the keys from the environment:\n');
    console.log(`  X402_BUYER_SOLANA_SECRET=<base58 secret from ${path.relative(ROOT, OUT)}>`);
    console.log(`  X402_BUYER_EVM_PRIVATE_KEY=<0x key from ${path.relative(ROOT, OUT)}>`);
  } else {
    console.log('Set these on the deployment (public values, safe to commit to config):\n');
    console.log(`  X402_PAY_TO_ADDRESS=${wallets.evm.address}`);
    console.log(`  X402_PAY_TO_ADDRESS_SOLANA=${wallets.solana.address}`);
  }
  console.log('');
  console.log(`Private keys: ${path.relative(ROOT, OUT)} (0600, gitignored).`);
  if (role === 'receiver') {
    console.log('They are only needed to move funds out. Never deploy them.\n');
  } else {
    console.log('Keep the balance small: whatever pays with this wallet can spend all of it.\n');
  }
}

if (has('show')) {
  const wallets = readWallets();
  if (!wallets) {
    console.error(`❌ no wallet file at ${OUT}. Run without --show to create one.`);
    process.exit(1);
  }
  report(wallets);
  process.exit(0);
}

if (fs.existsSync(OUT) && !has('force')) {
  console.error(
    `❌ ${path.relative(ROOT, OUT)} already exists. Funds may be sitting on those keys.\n` +
      '   Use --show to print the addresses, or --force to replace them.',
  );
  process.exit(1);
}

const wallets = {
  createdAt: new Date().toISOString(),
  role: ROLE,
  purpose:
    ROLE === 'buyer'
      ? 'x402 buyer wallet: pays for calls to a paid API'
      : 'x402 paid API receiving wallets for xactions.app',
  solana: { ...createSolanaWallet(), ...ASSETS.solana, explorer: undefined },
  evm: { ...createEvmWallet(), ...ASSETS.base, explorer: undefined },
};
delete wallets.solana.explorer;
delete wallets.evm.explorer;

fs.writeFileSync(OUT, `${JSON.stringify(wallets, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(OUT, 0o600);

console.log(`✅ wrote ${path.relative(ROOT, OUT)}`);
report(wallets);
