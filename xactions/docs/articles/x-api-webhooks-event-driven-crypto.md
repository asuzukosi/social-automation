# X API and Webhooks: Event-Driven Architecture for Crypto Apps

**Meta description:** Build event-driven crypto applications using X API webhooks and Account Activity API to trigger on-chain actions from social signals in real time.

---

## Introduction

Polling the X API on an interval is wasteful and slow. For crypto applications where latency between a social signal and an on-chain action can mean the difference between profit and loss, webhooks are the correct architecture. X's Account Activity API (AAA) delivers events — mentions, follows, DMs, likes — to your HTTP endpoint the moment they occur, letting you build reactive crypto systems that respond to social triggers without burning through rate limit budget.

This guide covers the complete architecture: CRC token validation, event ingestion, and wiring social signals to on-chain logic.

---

## Account Activity API vs. Filtered Stream

Both approaches deliver real-time data, but they serve different use cases:

| Feature | Account Activity API | Filtered Stream |
|---|---|---|
| Delivery | Webhook (HTTP POST) | SSE (long-lived GET) |
| Scope | Activity on specific accounts you own | Any public tweet matching rules |
| Reconnection | Automatic (X retries) | Your code must reconnect |
| Use case | React to your bot's mentions, DMs | Monitor any public conversation |

For crypto apps, the Account Activity API is ideal when you control a bot account (e.g., `@MyDeFiAlerts`) that users mention or DM to trigger actions.

---

## Setting Up the Webhook Endpoint

X requires your webhook URL to respond to a CRC (Challenge-Response Check) GET request before it will send events.

```javascript
// api/routes/xWebhook.js
import express from 'express';
import crypto from 'crypto';

const router = express.Router();
const CONSUMER_SECRET = process.env.X_CONSUMER_SECRET;

// CRC validation — X sends this to verify your endpoint
router.get('/webhook/x', (req, res) => {
  const crcToken = req.query.crc_token;
  if (!crcToken) return res.status(400).json({ error: 'No CRC token' });

  const hmac = crypto
    .createHmac('sha256', CONSUMER_SECRET)
    .update(crcToken)
    .digest('base64');

  res.json({ response_token: `sha256=${hmac}` });
});

// Event delivery — X POSTs events here
router.post('/webhook/x', express.json(), async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  await processXEvent(req.body);
});

export default router;
```

Always return `200` before doing any async work. X will retry if it doesn't get a fast response, leading to duplicate event processing.

---

## Validating Incoming Payloads

Every POST from X includes an `x-twitter-webhooks-signature` header. Validate it to reject spoofed requests.

```javascript
// api/middleware/xWebhookAuth.js
import crypto from 'crypto';

export function validateXSignature(req, res, next) {
  const signature = req.headers['x-twitter-webhooks-signature'];
  if (!signature) return res.sendStatus(403);

  const hmac = 'sha256=' + crypto
    .createHmac('sha256', process.env.X_CONSUMER_SECRET)
    .update(JSON.stringify(req.body))
    .digest('base64');

  const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac));
  if (!valid) return res.sendStatus(403);
  next();
}
```

---

## Processing Crypto-Relevant Events

The AAA payload structure varies by event type. For a crypto alert bot, the most useful events are `tweet_create_events` (mentions) and `direct_message_events` (DM commands).

```javascript
// api/services/xEventProcessor.js
import { triggerOnChainAlert } from './onChain.js';
import { parseCommand } from './commandParser.js';

export async function processXEvent(payload) {
  // Handle mentions — e.g., "@MyDeFiAlerts track 0xABCD..."
  if (payload.tweet_create_events) {
    for (const tweet of payload.tweet_create_events) {
      if (tweet.in_reply_to_screen_name === 'MyDeFiAlerts') {
        const command = parseCommand(tweet.text);
        if (command.type === 'track' && command.address) {
          await triggerOnChainAlert(command.address, tweet.user.screen_name);
        }
      }
    }
  }

  // Handle DMs — richer command interface
  if (payload.direct_message_events) {
    for (const dm of payload.direct_message_events) {
      if (dm.type !== 'message_create') continue;
      const text = dm.message_create.message_data.text;
      const senderId = dm.message_create.sender_id;
      const command = parseCommand(text);
      await handleDMCommand(command, senderId);
    }
  }
}
```

---

## Wiring to On-Chain Logic

Once you have a validated social trigger, the action can be anything: firing a webhook to a keeper bot, writing to a database that a monitoring service polls, or calling a smart contract via ethers.js.

```javascript
// api/services/onChain.js
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const alertContract = new ethers.Contract(
  process.env.ALERT_CONTRACT_ADDRESS,
  ['function registerWatch(address wallet, string calldata user) external'],
  new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, provider)
);

export async function triggerOnChainAlert(walletAddress, xUsername) {
  const tx = await alertContract.registerWatch(walletAddress, xUsername);
  await tx.wait();
  console.log(`✅ Registered watch for ${walletAddress} (requested by @${xUsername})`);
}
```

---

## Registering the Webhook with X

After your endpoint is deployed, register it via the API:

```bash
curl -X POST "https://api.twitter.com/1.1/account_activity/all/:env_name/webhooks.json" \
  -H "Authorization: OAuth ..." \
  --data "url=https://yourapp.com/webhook/x"
```

Then subscribe your bot account to receive events for that environment. X supports up to 1,000 subscriptions per environment on the Pro tier.

---

## Handling Reconnects and Failures

The AAA webhook model means X holds the retry responsibility, but you should still design for idempotency. Store a `processed_event_ids` set in Redis and skip duplicate processing:

```javascript
const processed = new Set();

export function isDuplicate(eventId) {
  if (processed.has(eventId)) return true;
  processed.add(eventId);
  setTimeout(() => processed.delete(eventId), 60_000);
  return false;
}
```

---

## Conclusion

X webhooks eliminate polling overhead and deliver sub-second social signals to your crypto infrastructure. The core pattern — CRC validation, signature verification, immediate 200 response, async processing — is straightforward but must be implemented correctly to avoid dropped events and security vulnerabilities. Combined with on-chain action triggers, this architecture lets you build responsive DeFi alert bots, keeper activation systems, and community-driven monitoring tools that react to social consensus in real time.
