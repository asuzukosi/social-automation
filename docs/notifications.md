# Notifications

Multi-channel notification hub for XActions alerts. Send notifications via Email, Slack, Discord, and Telegram when events occur — follower changes, workflow completions, scheduled job results, and more.

## Architecture

```
src/notifications/
└── notifier.js   # Multi-channel notification sender
```

**Configuration:** `~/.xactions/config.json` under the `notifications` key.

## Quick Start

### Node.js

```javascript
import { Notifier } from 'xactions/src/notifications/notifier.js';

const notifier = new Notifier();
await notifier.load();  // Load config from ~/.xactions/config.json

// Configure channels
notifier.configure({
  email: { enabled: true, to: 'you@example.com', smtp: { host: 'smtp.gmail.com', port: 587, user: '...', pass: '...' } },
  slack: { enabled: true, webhookUrl: 'https://hooks.slack.com/services/...' },
  discord: { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/...' },
  telegram: { enabled: true, botToken: '...', chatId: '...' }
});

// Send a notification
await notifier.send({
  type: 'follower_alert',
  title: 'Unfollower Detected',
  message: '@user123 unfollowed you',
  data: { username: 'user123', action: 'unfollow' },
  severity: 'warning'  // info | warning | critical
});
```

### CLI

```bash
xactions notify send "Test notification" --title "Hello" --severity info
xactions notify test slack
xactions notify configure
```

## REST API

Routes prefixed with `/api/notifications`. Requires authentication.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/notifications/send` | Send a notification |
| POST | `/api/notifications/test/:channel` | Send a test to a specific channel |
| POST | `/api/notifications/configure` | Update notification settings |

### Send a notification

```bash
curl -X POST http://localhost:3001/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{"message": "5 new unfollowers detected", "title": "Unfollower Alert", "severity": "warning"}'
```

### Test a channel

```bash
curl -X POST http://localhost:3001/api/notifications/test/slack
```

## Channels

### Email

```javascript
{
  email: {
    enabled: true,
    to: 'you@example.com',
    from: 'xactions@example.com',     // optional
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      user: 'your-email@gmail.com',
      pass: 'app-password'
    }
  }
}
```

### Slack

```javascript
{
  slack: {
    enabled: true,
    webhookUrl: 'https://hooks.slack.com/services/T.../B.../xxx'
  }
}
```

Create a webhook at [api.slack.com/apps](https://api.slack.com/apps) → Incoming Webhooks.

### Discord

```javascript
{
  discord: {
    enabled: true,
    webhookUrl: 'https://discord.com/api/webhooks/123/abc'
  }
}
```

Create a webhook in Discord → Server Settings → Integrations → Webhooks.

### Telegram

```javascript
{
  telegram: {
    enabled: true,
    botToken: '123456:ABC-DEF',
    chatId: '-1001234567890'
  }
}
```

Create a bot via [@BotFather](https://t.me/BotFather). Get your chat ID by messaging the bot and checking `/getUpdates`.

### Generic webhook (signed)

Any HTTPS endpoint can receive notifications. Unlike the Slack and Discord
channels, this one signs what it sends, retries, and keeps a delivery log you
can replay from.

```javascript
{
  webhook: {
    enabled: true,
    url: 'https://your-service.example/hooks/xactions'
  }
}
```

Set `XACTIONS_WEBHOOK_SECRET` and every delivery carries four headers:

| Header | Meaning |
|--------|---------|
| `X-XActions-Signature` | `sha256=<hex>`, an HMAC of the exact request body |
| `X-XActions-Timestamp` | Unix seconds when the body was signed |
| `X-XActions-Event` | Event name, for example `notification` |
| `X-XActions-Delivery` | UUID for this delivery, stable across retries |

Failed deliveries are retried three times with exponential backoff and jitter.
Every attempt is recorded in `~/.xactions/webhook-deliveries.json` (the last 500,
honours `XACTIONS_HOME`).

#### Verifying a delivery

Verify against the raw body, before any JSON parsing, or the bytes will not
match. The comparison is constant-time and rejects a timestamp older than five
minutes, so a captured request cannot be replayed at you later.

```javascript
import express from 'express';
import { verifyWebhookSignature } from 'xactions';

const app = express();

app.post('/hooks/xactions',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const result = verifyWebhookSignature(req.body, req.headers, process.env.XACTIONS_WEBHOOK_SECRET);
    if (!result.valid) return res.status(401).json({ error: result.reason });

    const event = JSON.parse(req.body.toString('utf8'));
    console.log(req.headers['x-xactions-event'], event);
    res.json({ ok: true });
  });
```

#### Inspecting and replaying

```javascript
import { listWebhookDeliveries, replayWebhookDelivery } from 'xactions';

listWebhookDeliveries({ status: 'failed', limit: 20 });
await replayWebhookDelivery('4b1f0c8e-...');  // same payload, new delivery id, linked by replayOf
```

`signWebhookBody` and `deliverWebhook` are exported from the package root too,
so a script can sign or send one directly without going through the notifier.

## Severity Levels

| Level | Use Case |
|-------|----------|
| `info` | Routine updates — job completed, export ready |
| `warning` | Notable events — unfollowers detected, rate limit approaching |
| `critical` | Urgent — account restricted, stream errors, auth expired |

## Integration with Other Modules

Notifications integrate with:

- **Streams** — Alert on follower changes, new mentions
- **Workflows** — Notify on step completion/failure
- **Scheduler** — Report job execution results
- **Bulk operations** — Summary after batch completes

### Workflow Step Example

```javascript
{
  action: 'send_notification',
  params: {
    title: 'Workflow Complete',
    message: 'Found {{steps.0.result.count}} new leads',
    severity: 'info'
  }
}
```
