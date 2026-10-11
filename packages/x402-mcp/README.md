# @xactions/x402-mcp

**Charge for MCP tools.** An agent calls your tool, your server answers with a
price instead of a result, the agent pays from its own wallet, and calls again.
No API key. No account. No signup form a robot cannot fill in.

```
npm install @xactions/x402-mcp
```

Zero dependencies. Runs on Cloudflare Workers, Deno, Bun, Node 18+, and anywhere
else `fetch` exists.

Live example: [`https://xactions.app/mcp`](https://xactions.app/mcp) sells public
X/Twitter data at $0.001 a call.

---

## Why

MCP gave agents a way to call tools. It gave nobody a way to charge for them, so
every hosted MCP server today is either free or hidden behind an API key.

An API key assumes a human signed up. An agent cannot sign up. It cannot read the
confirmation email, cannot pass the CAPTCHA, cannot agree to terms on your
behalf, and cannot wait three business days for approval. So the tools an agent
can actually reach are the free ones, and the free ones are the ones nobody
maintains.

x402 removes the question. The agent proves it will pay, and the proof is a
signature over a stablecoin transfer. Your server learns exactly one thing about
the caller: the address the money came from. Nothing to issue, nothing to rotate,
nothing to leak.

## Add payment to a server you already have

Three lines, wherever your JSON-RPC messages arrive.

```js
import { createToolPaymentGate } from '@xactions/x402-mcp';

const gate = createToolPaymentGate({
  payTo: { 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'YourSolanaAddress' },
  prices: { search: '$0.01', summarize: '$0.002' },   // absent = free
});

// in your handler:
const checked = await gate.check({ message, request });
if (checked.response) return checked.response;          // unpaid: return the terms
const response = await yourServer.handle(message, checked.context);
return gate.finalize(response, checked);                // paid: settle, attach receipt
```

`checked.context.payment.payer` is the address that paid, if your tool wants it.

Settlement happens in `finalize`, **after** your tool produced a result. A tool
that throws is never billed, and a receipt always corresponds to a result the
caller actually received.

## Or write the whole server

If you are starting fresh, skip the JSON-RPC entirely.

```js
import { createPaidMcpServer } from '@xactions/x402-mcp';

const server = createPaidMcpServer({
  name: 'weather',
  payTo: {
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': process.env.SOLANA_ADDRESS,
    'eip155:8453': process.env.BASE_ADDRESS,
  },
  tools: [
    {
      name: 'forecast',
      description: 'Ten-day forecast for a city',
      price: '$0.002',
      inputSchema: { type: 'object', required: ['city'], properties: { city: { type: 'string' } } },
      handler: async ({ city }) => getForecast(city),
    },
  ],
});

export default { fetch: (request) => server.handle(request) };
```

That is a complete, spec-compliant MCP server over Streamable HTTP: `initialize`,
`tools/list`, `tools/call`, batching, notifications, CORS. Deploy it to a Worker
and agents can pay for it from anywhere.

## Buy from one

```js
import { PaidMcpClient } from '@xactions/x402-mcp/client';

const client = new PaidMcpClient('https://xactions.app/mcp', {
  signers: [mySolanaSigner],
  maxPerCall: '$0.01',
  budget: '$1.00',
});

const result = await client.call('x_profile', { handle: 'nasa' });
console.log(result.structuredContent.profile.followers);
console.log(client.spent());        // '$0.001000'
console.log(client.receipts());     // on-chain transaction ids
```

`call()` handles the whole dance: it calls, sees the terms, checks them against
your limits, signs, calls again, and returns the result.

### Spending is bounded by construction

A server can name any amount and any recipient in its terms. All three guards are
checked **before** a signer ever sees them:

| Guard | Effect |
|---|---|
| `maxPerCall` | Refuse a single call above this |
| `budget` | Refuse once the session total would pass this |
| `allowPayTo` | Only ever pay these addresses |

Breaching one throws `SpendLimitError` and nothing is signed.

### Signers

Signing needs a wallet library and a chain, so it is yours to supply:

```js
const mySolanaSigner = {
  networks: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  async createPayment(requirements) {
    // @x402/svm, @solana/kit, or your own
    return scheme.createPaymentPayload(1, requirements);
  },
};
```

## What agents see

`tools/list` carries the price, so an agent can budget before it calls rather
than discovering the cost by being refused:

```json
{
  "name": "x_profile",
  "description": "Public profile for one X account (costs $0.001000 in USDC via x402)",
  "_meta": {
    "x402/price": { "amount": "1000", "currency": "USDC", "display": "$0.001000" },
    "x402/networks": ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "eip155:8453"]
  }
}
```

An unpaid `tools/call` comes back as a tool result, not a protocol error, so a
client that does not speak x402 still shows the user something readable:

```json
{
  "isError": true,
  "structuredContent": {
    "x402Version": 1,
    "error": "Payment required: x_profile costs $0.001000",
    "accepts": [
      { "scheme": "exact", "network": "solana:5eykt...", "amount": "1000",
        "asset": "EPjFWdd5...", "payTo": "2DdJ6Ax...",
        "extra": { "feePayer": "CjNFTjv..." } }
    ]
  }
}
```

A paid one comes back with the receipt:

```json
{
  "structuredContent": { "profile": { "...": "..." } },
  "_meta": {
    "x402/payment-response": {
      "success": true,
      "transaction": "5Nq8...",
      "network": "solana",
      "payer": "68GFkVV..."
    }
  }
}
```

## Chains

Any chain the configured facilitator settles. USDC addresses for the common ones
are built in, so `payTo` is usually all you configure.

Solana is worth leading with: sub-second finality and fees around $0.00025 are
what make a $0.001 call a payment rather than a rounding error against gas. On
both Solana and EVM the facilitator pays the network fee, so a buyer wallet holds
nothing but USDC.

### The facilitator is checked, not trusted

Before terms are published they are intersected with the facilitator's own
`/supported` list, and whatever `extra` it needs is merged in:

- **Solana** requires `extra.feePayer`, the account that pays the fee and
  co-signs. Only the facilitator knows it. Omit it and every Solana payment fails
  with `missing_fee_payer` and no way for the payer to discover the right value.
- **EVM** requires the EIP-712 domain the wallet signs `transferWithAuthorization`
  against.

A chain the facilitator cannot settle is dropped rather than advertised. If
`/supported` is unreachable the configured chains are offered unchanged, because
one blip should not quietly turn a paid API into a free one.

The default facilitator is [PayAI's](https://facilitator.payai.network): no key,
settles Base and Solana mainnet. The reference facilitator at `x402.org` is
**testnet only**, which is a trap worth knowing about: point a production server
at it and you publish mainnet terms nobody can pay.

## Both protocol versions

Two generations of x402 are on the wire and this speaks both, so an older client
and a current one behave identically.

| | v1 | v2 |
|---|---|---|
| Chain id | `base`, `solana` | `eip155:8453`, `solana:5eykt...` |
| Amount field | `maxAmountRequired` | `amount` |
| HTTP payment header | `X-PAYMENT` | `PAYMENT-SIGNATURE` |

Terms carry both amount fields, payments are read from either header or from the
MCP `_meta["x402/payment"]`, and an incoming payment matches on either spelling
of the chain. This matters more than it sounds: a v1 indexer handed a CAIP-2 id
rejects the whole challenge as unparseable.

## API

| Export | Purpose |
|---|---|
| `createToolPaymentGate(options)` | Add payment to an existing MCP server |
| `createPaidMcpServer(options)` | A complete paid MCP server as one `fetch` handler |
| `PaidMcpClient` | An MCP client that pays for what it calls |
| `FacilitatorClient` | `/supported`, `/verify`, `/settle`, with caching |
| `buildAccepts`, `matchRequirements` | Build and match payment terms |
| `encodePayment`, `decodePayment` | The base64 header codec |
| `toAtomicAmount`, `toDollars` | `'$0.001'` to `'1000'` and back |
| `toV1Network`, `sameNetwork` | Chain identifier spellings |

## Testing

`npm test` from the repository root runs 35 tests: the server over its real fetch
handler, and the client wired straight into it, so both halves are exercised over
the real JSON-RPC wire format. Only the facilitator and the wallet are stubbed,
because one is another company's service and the other would move money.

## License

Apache-2.0. Built for [XActions](https://xactions.app) by
[@nichxbt](https://x.com/nichxbt).
