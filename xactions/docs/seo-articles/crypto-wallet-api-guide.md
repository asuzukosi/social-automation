---
title: "Crypto Wallet APIs: Generate, Manage, and Query Wallets (2026)"
meta_description: "How to use crypto wallet APIs — generate HD wallets, query balances across chains, sign transactions, and integrate WalletConnect."
keywords: "crypto wallet API, HD wallet API, WalletConnect API, ethers.js wallet, Web3 wallet integration"
---

# Crypto Wallet APIs: Generate, Manage, and Query Wallets (2026)

Wallet APIs span key generation, signing, multi-chain balance queries, and browser wallet integrations. This guide covers all layers.

## Generate an HD Wallet (ethers.js)

```javascript
import { ethers } from 'ethers';

// Generate random wallet
const wallet = ethers.Wallet.createRandom();
console.log('Address:', wallet.address);
console.log('Private key:', wallet.privateKey); // NEVER share or log in production
console.log('Mnemonic:', wallet.mnemonic.phrase);

// Restore from mnemonic
const restored = ethers.Wallet.fromPhrase('word1 word2 ... word12');

// HD derivation (BIP44)
const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic);
const account0 = hdNode.derivePath("m/44'/60'/0'/0/0");
const account1 = hdNode.derivePath("m/44'/60'/0'/0/1");
```

## Sign Messages and Transactions

```javascript
const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Sign a message (off-chain, no gas)
const signature = await signer.signMessage('Hello World');
const recovered = ethers.verifyMessage('Hello World', signature);
console.log('Signer is valid:', recovered === signer.address);

// Sign typed data (EIP-712)
const domain = { name: 'MyApp', version: '1', chainId: 1 };
const types = { Permit: [{ name: 'owner', type: 'address' }, { name: 'value', type: 'uint256' }] };
const value = { owner: signer.address, value: 1000n };
const sig = await signer.signTypedData(domain, types, value);
```

## Browser Wallet Integration (MetaMask / EIP-1193)

```javascript
// Request wallet connection
async function connectWallet() {
  if (!window.ethereum) throw new Error('No wallet detected');

  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();

  return { provider, signer, address: accounts[0] };
}

// Listen for account/chain changes
window.ethereum.on('accountsChanged', (accounts) => {
  console.log('New account:', accounts[0]);
});

window.ethereum.on('chainChanged', (chainId) => {
  window.location.reload(); // recommended
});

// Switch chain
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x2105' }] // Base
});
```

## WalletConnect v2

```javascript
import { WalletConnect } from '@walletconnect/ethereum-provider';

const provider = await WalletConnect.init({
  projectId: process.env.WALLETCONNECT_PROJECT_ID,
  chains: [1],
  optionalChains: [8453, 42161, 137],
  showQrModal: true
});

await provider.enable();
const ethProvider = new ethers.BrowserProvider(provider);
const signer = await ethProvider.getSigner();
```

## Privy (Embedded Wallets)

```javascript
import { PrivyProvider, useWallets } from '@privy-io/react-auth';

// In a component
const { wallets } = useWallets();
const embedded = wallets.find(w => w.walletClientType === 'privy');

const provider = await embedded.getEthersProvider();
const signer = provider.getSigner();
```

## Multi-Chain Balance Query

```javascript
async function getAllBalances(address) {
  const chains = [
    { name: 'Ethereum', rpc: process.env.ETH_RPC, nativeSymbol: 'ETH' },
    { name: 'Polygon', rpc: 'https://polygon-rpc.com', nativeSymbol: 'MATIC' },
    { name: 'Base', rpc: 'https://mainnet.base.org', nativeSymbol: 'ETH' },
    { name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', nativeSymbol: 'ETH' }
  ];

  const results = await Promise.all(chains.map(async ({ name, rpc, nativeSymbol }) => {
    const p = new ethers.JsonRpcProvider(rpc);
    const balance = await p.getBalance(address);
    return { chain: name, symbol: nativeSymbol, balance: ethers.formatEther(balance) };
  }));

  return results.filter(r => parseFloat(r.balance) > 0);
}
```
