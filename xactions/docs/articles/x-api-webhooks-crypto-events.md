# X API Webhooks for Real-Time Crypto Event Monitoring

**Meta description:** Set up X API Account Activity webhooks to monitor real-time crypto events — mentions, DMs, and engagements — with low latency and reliable delivery.

---

## Introduction

The X API filtered stream is excellent for monitoring public content, but it only covers public tweets. X API Account Activity webhooks give you a different capability: real-time event delivery for specific accounts you manage, including mentions, replies, DMs, follows, and engagement signals. For crypto apps that operate managed accounts — trading bots, DAO multisig signers, project announcement accounts — webhooks are the right tool. This guide covers the full setup and event processing pipeline.

---

## What Account Activity Webhooks Deliver

Account Activity API (AAA) webhooks push events for subscribed accounts in near real-time:

- **Mentions** — someone tags your account in a tweet
- **Direct messages** — incoming and outgoing DMs
- **Tweet deletions** — when your tweets are deleted
- **Favorite events** — when someone likes a tweet from your account
- **Follow/unfollow events** — follower changes
- **Retweet and quote events** — amplification tracking

For crypto monitoring, the high-value signals are mentions (alerting on project mentions) and follow events (detecting coordinated follow/unfollow campaigns).

---

## Registering Your Webhook Endpoint

Your server must respond to a CRC (Challenge Response Check) from X before the webhook is activated:

```javascript
import crypto from 'crypto';
import express from 'express';

const app = express();
app.use(express.json());

// CRC challenge handler — X hits this to verify your endpoint
app.get('/webhooks/x', (req, res) => {
  const crcToken = req.query.crc_token;
  if (!crcToken) return res.status(400).json({ error: 'Missing crc_token' });

  const hmac = crypto
    .createHmac('sha256', process.env.X_CONSUMER_SECRET)
    .update(crcToken)
    .digest('base64');

  res.json({ response_token: `sha256=${hmac}` });
});

// Event receiver
app.post('/webhooks/x', (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  processEvents(req.body).catch(console.error);
});

app.listen(3000);
```

Acknowledge the POST with a 200 before doing any processing — X will retry if you don't respond within 3 seconds.

---

## Registering the Webhook with X API

```javascript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// Register webhook URL (requires Basic or Pro access tier)
async function registerWebhook() {
  const result = await client.v1.registerAccountActivityWebhook(
    process.env.X_WEBHOOK_ENV,  // e.g., 'production'
    'https://yourapp.com/webhooks/x'
  );
  console.log('Webhook ID:', result.id);
}

// Subscribe an account to the webhook
async function subscribeAccount() {
  await client.v1.subscribeToAccountActivity(process.env.X_WEBHOOK_ENV);
  console.log('Subscribed');
}
```

You need separate OAuth credentials for each account you want to subscribe.

---

## Processing Crypto-Relevant Events

```javascript
async function processEvents(body) {
  // Mention detection — high priority for project accounts
  if (body.tweet_create_events) {
    for (const tweet of body.tweet_create_events) {
      const isMention = tweet.entities?.user_mentions?.some(
        m => m.screen_name === process.env.MONITORED_HANDLE
      );
      if (isMention) await handleMention(tweet);
    }
  }

  // Follow events — watch for coordinated follow waves (potential pump signals)
  if (body.follow_events) {
    for (const event of body.follow_events) {
      if (event.type === 'follow') {
        await handleFollowEvent(event);
        await detectFollowWave(event.source.id);
      }
    }
  }

  // DM events — useful for bot-based trading alerts
  if (body.direct_message_events) {
    for (const dm of body.direct_message_events) {
      if (dm.type === 'message_create') await handleDm(dm);
    }
  }
}
```

---

## Detecting Coordinated Follow Waves

A sudden spike in follows from new accounts can signal an incoming pump coordinated on X. Track follow events in Redis:

```javascript
async function detectFollowWave(sourceId) {
  const key = `follows:incoming:${Date.now() - (Date.now() % 300000)}`; // 5-min bucket
  const count = await redis.incr(key);
  await redis.expire(key, 600);

  if (count > 50) {
    await sendAlert(`⚠️ Follow wave detected: ${count} follows in 5 minutes`);
  }
}
```

Cross-reference new followers against account age and tweet count to filter bot accounts before firing alerts.

---

## Handling Webhook Reliability

Webhooks can fail. X retries for 24 hours but doesn't guarantee delivery order. Build your processor to be idempotent:

```javascript
async function handleMention(tweet) {
  const existing = await db.mentionEvent.findUnique({ where: { tweetId: tweet.id_str } });
  if (existing) return; // Already processed

  await db.mentionEvent.create({
    data: {
      tweetId: tweet.id_str,
      authorId: tweet.user.id_str,
      text: tweet.text,
      receivedAt: new Date(),
    },
  });

  await triggerDownstreamAlerts(tweet);
}
```

Store the `tweet.id_str` as a unique key. Duplicate delivery is harmless with this pattern.

---

## Periodic CRC Re-validation

X sends periodic CRC challenges to verify your endpoint is still live. Log failures explicitly:

```javascript
// Monitor webhook health
setInterval(async () => {
  try {
    const webhooks = await client.v1.getAccountActivityWebhooks(process.env.X_WEBHOOK_ENV);
    const webhook = webhooks[0];
    if (!webhook?.valid) {
      console.error('❌ Webhook invalid — re-registering');
      await registerWebhook();
    }
  } catch (err) {
    console.error('❌ Webhook health check failed:', err.message);
  }
}, 3600000); // Check hourly
```

---

## Conclusion

X API Account Activity webhooks are the right tool when you're operating managed accounts and need event-driven reactions rather than polling. For crypto apps, the high-value use cases are mention monitoring for project accounts, follow wave detection as a pump signal, and DM-based bot interfaces for trading alerts. Keep your endpoint fast, acknowledge immediately, process asynchronously, and build idempotent handlers — webhook delivery is best-effort, not guaranteed.
