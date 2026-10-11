# Real-Time Streaming

> Subscribe to live tweet, follower, and mention events via polling + Socket.IO, or push events straight off x.com's own event pipeline. No API keys needed.

## Overview

The streaming system provides near-real-time monitoring of Twitter/X activity by polling at configurable intervals and emitting events through Socket.IO. It uses:

- **Bull queue** (Redis) for reliable scheduled polling
- **Browser pool** for managed Puppeteer instances
- **Redis** for deduplication and state persistence
- **Socket.IO** for real-time event emission to clients

---

## Quick Start

### Node.js

```javascript
import { createStream, stopStream, listStreams, setIO } from 'xactions/streaming';

// Optional: connect Socket.IO for real-time events
import { Server } from 'socket.io';
const io = new Server(httpServer);
setIO(io);

// Start a tweet stream
const stream = await createStream({
  type: 'tweet',
  username: 'elonmusk',
  interval: 60,         // Poll every 60 seconds (default)
  authToken: 'your_auth_token'
});

console.log(stream);
// { id: 'abc123', type: 'tweet', username: 'elonmusk', status: 'active', interval: 60000 }

// List active streams
const streams = await listStreams();

// Stop a stream
await stopStream(stream.id);
```

### MCP (AI Agents)

```
"Start monitoring @elonmusk's tweets in real-time"
→ Uses x_stream_start tool

"Show me all active streams"
→ Uses x_stream_list tool

"Stop monitoring @elonmusk"
→ Uses x_stream_stop tool
```

### API

```bash
# Start a stream
curl -X POST http://localhost:3001/api/streams/start \
  -H "Content-Type: application/json" \
  -d '{"type": "tweet", "username": "elonmusk", "interval": 60}'

# List streams
curl http://localhost:3001/api/streams

# Stop a stream
curl -X POST http://localhost:3001/api/streams/stop \
  -d '{"streamId": "abc123"}'
```

---

## Stream Types

| Type | What it monitors | Events emitted |
|------|-----------------|----------------|
| `tweet` | New tweets from a user | `stream:tweet:new` |
| `follower` | Follower count changes | `stream:follower:new`, `stream:follower:lost` |
| `mention` | Mentions of a user | `stream:mention:new` |

A stream can also run on the live transport instead of polling, which adds the
`stream:engagement`, `stream:dm` and `stream:typing` events. See
[Live event stream](#live-event-stream).

---

## Live event stream

Polling asks x.com "anything new?" every 15 seconds or more. The live pipeline
is the other direction: x.com's own web client keeps one long-lived connection
open to `https://api.x.com/live_pipeline/events` and receives frames as things
happen. XActions speaks the same protocol, so engagement counters, DM updates
and typing indicators arrive in under a second with no polling interval at all.

Two things to know before you build on it:

- **It needs a logged-in session.** Guest tokens are rejected. The connection
  carries the `auth_token` and `ct0` cookies, exactly like every other authed
  call in the toolkit. Without them `open()` fails with `LivePipelineAuthError`
  before a request is made.
- **It is not a WebSocket, whatever its reputation says.** The endpoint answers
  an `Upgrade: websocket` request the same way it answers a plain GET, and the
  web client reads it as a chunked HTTP response of newline-delimited JSON.
  `createLivePipeline()` speaks that transport. Everything a WebSocket would
  give you (push delivery, live subscription changes, automatic reconnect) is
  here; the wire format underneath is just HTTP.

### Quick start

```javascript
import { TwitterHttpClient } from 'xactions/scrapers/twitter/http';
import { createLivePipeline, Topic } from 'xactions/streaming';

// auth_token and ct0 from a logged-in session
const client = new TwitterHttpClient({ cookies: process.env.X_COOKIES });

const pipeline = createLivePipeline({
  client,
  topics: [Topic.tweetEngagement('1749528513')],
  onEvent: (event) => {
    if (event.type === 'engagement') {
      console.log(`likes ${event.payload.likeCount}, views ${event.payload.viewCount}`);
    }
  },
  onError: (err, info) => {
    console.error(err.message, info); // { fatal, willRetry, attempt, delayMs }
  },
});

const { sessionId } = await pipeline.open();
console.log('live pipeline session', sessionId);

// Change what you are watching without dropping the connection
await pipeline.subscribe(Topic.tweetEngagement('1765829534'));
await pipeline.unsubscribe(Topic.tweetEngagement('1749528513'));

// Resolves once the connection is shut and every timer is cleared
await pipeline.close();
```

### Topics

A topic names one thing to watch. Build them with the `Topic` helpers rather
than by hand, so a missing id fails at the call site instead of silently
subscribing to nothing.

| Helper | Topic string | What arrives |
|--------|--------------|--------------|
| `Topic.tweetEngagement(tweetId)` | `/tweet_engagement/<tweetId>` | Like, retweet, quote, reply and view counters as they change |
| `Topic.dmUpdate(conversationId)` | `/dm_update/<conversationId>` | A new message landed in that conversation |
| `Topic.dmTyping(conversationId)` | `/dm_typing/<conversationId>` | The other side is typing |

A conversation id is either a group id (`1234567890`) or `partnerId-yourId`
(`1234567890-9876543210`).

**DM topics only attach on the opening connection.** x.com answers a
mid-session `subscribe()` for a `dm_update` or `dm_typing` topic with an entry
in the subscription error list, so pass them to `createLivePipeline({ topics })`
rather than adding them later. Engagement topics can be added and removed at
any time.

### Event shape

Every frame is normalised into the same object, and the untouched frame is kept
on `raw` so nothing x.com sends is lost:

```javascript
{
  type: 'engagement',                       // engagement | dm | typing | config | unknown
  topic: '/tweet_engagement/1749528513',
  payload: { tweetId: '1749528513', likeCount: 12, retweetCount: 3,
             quoteCount: 1, replyCount: 0, viewCount: 4096,
             viewCountState: 'EnabledWithCount' },
  receivedAt: '2026-08-27T20:11:04.512Z',
  raw: { topic: '...', payload: { tweet_engagement: { like_count: '12', ... } } }
}
```

| `type` | `payload` |
|--------|-----------|
| `engagement` | `{ tweetId, likeCount, retweetCount, quoteCount, replyCount, viewCount, viewCountState }`, counters as numbers, `null` when the frame omits one |
| `dm` | `{ conversationId, userId }` |
| `typing` | `{ conversationId, userId }` |
| `config` | `{ kind: 'session', sessionId, subscriptionTtlMillis, heartbeatMillis }` on connect, or `{ kind: 'subscriptions', errors }` after a subscription change |
| `unknown` | `{ name, data }` for a frame key this version does not model yet |

One frame can carry several payload keys, and each one becomes its own event.

### Resilience

| Behaviour | What happens |
|-----------|--------------|
| Keepalive | Blank keepalive lines re-arm a silence watchdog set to three times the heartbeat interval the server advertises. Silence past that aborts the connection and reconnects, rather than leaving a dead socket open |
| Subscription TTL | The server expires subscriptions after `subscriptionTtlMillis`; the pipeline re-asserts the current topic set at 80% of that window |
| Reconnect | Exponential backoff with jitter (`minDelayMs * factor^(attempt-1)`, capped at `maxDelayMs`, spread by `jitter`). Tune with `reconnect: { minDelayMs, maxDelayMs, factor, jitter, maxAttempts, random }`, or pass `reconnect: false` |
| Resubscribe | The reconnect carries the live topic set, including topics added by `subscribe()` after the first connect |
| Auth failure | Never retried. `LivePipelineAuthError` is fatal: refresh the cookies and open again |
| Give up | Once `maxAttempts` reconnects are spent, `onError` fires with `{ fatal: true }` and a `reconnect_exhausted` error, and the pipeline is closed |
| `close()` | Resolves after the read loop and the reconnect supervisor have both finished, so nothing is left running behind it |

### Using it from the stream manager

`createStream()` takes a `transport` option. It defaults to `poll`, so existing
streams behave exactly as before.

```javascript
import { createStream } from 'xactions/streaming';

const stream = await createStream({
  type: 'tweet',
  username: 'elonmusk',
  transport: 'live',
  topics: ['/tweet_engagement/1749528513'],
  cookies: process.env.X_COOKIES,   // auth_token AND ct0
});
```

Events reach Socket.IO clients and the stream history under
`stream:engagement`, `stream:dm` and `stream:typing`, alongside the polling
events, each tagged `transport: 'live'`:

```javascript
socket.on('stream:engagement', (data) => {
  // { streamId, username, transport: 'live', topic, data: { likeCount, ... }, timestamp }
});
```

**Polling is always the fallback.** If the pipeline cannot open (no topics, no
logged-in session, x.com unreachable) or gives up reconnecting later, the
manager logs the reason once, sets `transportFallbackReason` on the stream, and
schedules the normal poll job. A live stream never leaves you with no data.

`updateStream(streamId, { topics })` diffs the topic set and applies it to the
running session, so a watch list can change without a reconnect.

### API reference

| Function | Signature | Description |
|----------|-----------|-------------|
| `createLivePipeline(options)` | `({ client, topics?, onEvent?, onError?, reconnect?, fetch?, eventsUrl?, subscriptionsUrl?, openTimeoutMs?, heartbeatTimeoutMs? }) → LivePipeline` | Build a pipeline. Nothing connects until `open()` |
| `pipeline.open()` | `() → Promise<{ sessionId, topics }>` | Connect and resolve on the session config frame. Rejects without retrying, so a caller can fall back |
| `pipeline.subscribe(topics)` | `(string\|string[]) → Promise<{ topics, errors, raw }\|null>` | Add topics to the running session |
| `pipeline.unsubscribe(topics)` | `(string\|string[]) → Promise<{ topics, errors, raw }\|null>` | Drop topics from the running session |
| `pipeline.close()` | `() → Promise<void>` | Shut the connection down and settle |
| `pipeline.sessionId` / `.topics` / `.isOpen` / `.state` / `.stats` | getters | Session id, live topic set, and counters (`connects`, `reconnects`, `frames`, `events`, `malformedFrames`, `lastFrameAt`, `lastError`) |
| `Topic` | object | `tweetEngagement`, `dmUpdate`, `dmTyping` |
| `normalizeFrame(frame)` | `(object) → Event[]` | Frame to typed events, exported for anyone parsing captured traffic |
| `computeBackoffDelay(attempt, opts)` | `(number, object) → number` | The reconnect schedule, exported so it can be reasoned about and tested |
| `LivePipelineError` / `LivePipelineAuthError` | classes | Typed failures. `LivePipelineError.code` is one of `not_open`, `no_config`, `open_timeout`, `http_error`, `no_body`, `parse_error`, `handler_error`, `heartbeat_timeout`, `stream_closed`, `reconnect_exhausted` |

### What x.com may change

This is x.com's internal pipeline, not a documented API. The endpoint paths,
the frame keys, and the topic shapes here were read from the live service and
can change without notice. Two design choices keep that from being a cliff: an
unrecognised payload key arrives as an `unknown` event with the raw frame
attached rather than being dropped, and the stream manager falls back to
polling whenever the pipeline stops working. If frames stop arriving, check
`pipeline.stats.malformedFrames` and the `raw` payload of an `unknown` event
before assuming the session is at fault.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `localhost` | Redis server host |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | _(none)_ | Redis password |
| `XACTIONS_SESSION_COOKIE` | _(none)_ | Default auth token for streams |

### Interval Limits

| Setting | Value |
|---------|-------|
| Default interval | 60 seconds |
| Minimum interval | 15 seconds |
| Maximum interval | 3,600 seconds (1 hour) |
| Auto-stop threshold | 10 consecutive errors |

---

## Socket.IO Events

Clients can subscribe to real-time events:

```javascript
// Client-side
const socket = io('http://localhost:3001');

socket.on('stream:tweet:new', (data) => {
  console.log('New tweet:', data);
  // { streamId, username, tweet: { text, author, timestamp, url } }
});

socket.on('stream:follower:new', (data) => {
  console.log('New follower:', data);
  // { streamId, username, follower: { username, name } }
});

socket.on('stream:follower:lost', (data) => {
  console.log('Lost follower:', data);
  // { streamId, username, unfollower: { username } }
});

socket.on('stream:mention:new', (data) => {
  console.log('New mention:', data);
  // { streamId, username, mention: { text, author, timestamp } }
});

socket.on('stream:error', (data) => {
  console.log('Stream error:', data);
  // { streamId, error, consecutiveErrors }
});
```

---

## API Reference

### Stream Management

| Function | Signature | Description |
|----------|-----------|-------------|
| `createStream(config)` | `({ type, username, interval?, authToken?, userId? }) → Promise<Object>` | Start a new stream |
| `stopStream(streamId)` | `(string) → Promise<{ success, streamId }>` | Stop and remove a stream |
| `stopAllStreams()` | `() → Promise<{ stopped, failed, total }>` | Emergency shutdown |
| `pauseStream(streamId)` | `(string) → Promise<Object>` | Pause polling, retain state |
| `resumeStream(streamId)` | `(string) → Promise<Object>` | Resume a paused stream |
| `updateStream(streamId, updates)` | `(string, Object) → Promise<Object>` | Update stream config |
| `listStreams()` | `() → Promise<Object[]>` | All active streams |
| `getStreamStatus(streamId)` | `(string) → Promise<Object>` | Detailed stream status |
| `getStreamHistory(streamId, limit?)` | `(string, number?) → Promise<Object[]>` | Recent events |
| `getStreamStats()` | `() → Promise<Object>` | Aggregate statistics |
| `isHealthy()` | `() → Promise<boolean>` | Health check |
| `setIO(io)` | `(SocketIO.Server) → void` | Connect Socket.IO server |
| `shutdown()` | `() → Promise<void>` | Graceful shutdown |

### Browser Pool

| Function | Signature | Description |
|----------|-----------|-------------|
| `acquireBrowser()` | `() → Promise<Browser>` | Get a Puppeteer browser from the pool |
| `releaseBrowser(browser)` | `(Browser) → void` | Return browser to pool |
| `acquirePage(browser)` | `(Browser) → Promise<Page>` | Get a stealth page |
| `releasePage(page)` | `(Page) → Promise<void>` | Close and return page |
| `closeAllBrowsers()` | `() → Promise<void>` | Close all pooled browsers |
| `getBrowserPoolStatus()` | `() → Object` | Pool status and stats |

### Poll Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `pollTweets(username, options)` | `(string, Object) → Promise<Object[]>` | Poll for new tweets |
| `pollFollowers(username, options)` | `(string, Object) → Promise<Object>` | Poll follower changes |
| `pollMentions(username, options)` | `(string, Object) → Promise<Object[]>` | Poll for mentions |

### Constants

| Constant | Value |
|----------|-------|
| `STREAM_TYPES` | `['tweet', 'follower', 'mention']` |

---

## Redis Data Model

Streams persist state in Redis with a 7-day TTL:

```
xactions:stream:{streamId}:state    → { status, lastPoll, consecutiveErrors, ... }
xactions:stream:{streamId}:history  → List of recent events (capped)
xactions:stream:{streamId}:meta     → { type, username, createdAt, ... }
xactions:stream:{streamId}:lock     → Distributed lock for poll coordination
```

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Client App  │◄───│  Socket.IO   │◄───│ Stream Mgr  │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌──────────────┐     ┌──────▼──────┐
                    │ Browser Pool │◄───│  Bull Queue  │
                    │ (Puppeteer)  │     │   (Redis)    │
                    └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │   x.com     │
                    │  (polling)  │
                    └─────────────┘
```
