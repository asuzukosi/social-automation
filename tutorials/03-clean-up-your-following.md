# Tutorial 03 — Clean up your following list

**Time:** 20 minutes · **Login required:** yes · **You need:** Tutorial 01 finished

The job XActions is best known for: find the accounts you follow that do not
follow you back, and unfollow the ones you actually want gone.

The important word is *review*. The failure mode here is not a bug, it is
unfollowing 400 accounts in three minutes, getting throttled by X, and
discovering afterwards that you removed people you meant to keep. This tutorial
is built around not doing that.

---

## Step 0 — Log in

```bash
npx xactions connect
```

That opens a real browser, waits for you to log in normally, and captures the
session. If you are already logged in to X in a local browser,
`npx xactions login --from-browser chrome` skips the window entirely.

Follower and following lists are session-tier: X will not serve them to a
logged-out request, and you need both `auth_token` and `ct0`. See
[Tutorial 01, step 4](01-your-first-scrape.md#step-4--log-in) for the manual
route and for what each cookie does. `npx xactions doctor` confirms where you
stand.

---

## Step 1 — Look before you touch

```bash
npx xactions non-followers YOUR_USERNAME
```

```
📊 Follow Analysis

  Total Following: 1247
  Mutuals:         389
  Non-Followers:   858

Non-followers:
  @account_one - Display Name
  @account_two - Another Name
  ...
  ... and 838 more
```

This reads both lists and diffs them. It changes nothing.

Save the full list before going further:

```bash
npx xactions non-followers YOUR_USERNAME --limit 5000 --output non-followers.json
```

`--limit` defaults to 500, which is not enough for most accounts. `--json`
prints the same data on stdout instead, if you would rather pipe it.

---

## Step 2 — Decide who you actually want gone

858 accounts is not a decision, it is a number. Sort it into things you can
judge. `sort-non-followers.js`:

```js
import { readFileSync, writeFileSync } from 'node:fs';

const accounts = JSON.parse(readFileSync('non-followers.json', 'utf8'));

// Accounts you almost certainly followed on purpose: nobody expects a
// reciprocal follow from a 500k-follower account.
const large = accounts.filter((a) => (a.followersCount || 0) > 10_000);

// Dormant or abandoned: no posts, or a follower count near zero.
const inactive = accounts.filter(
  (a) => (a.tweetCount || 0) < 5 || (a.followersCount || 0) < 10,
);

const largeSet = new Set(large.map((a) => a.username));
const inactiveSet = new Set(inactive.map((a) => a.username));
const ordinary = accounts.filter(
  (a) => !largeSet.has(a.username) && !inactiveSet.has(a.username),
);

console.log(`Large accounts (probably keep):  ${large.length}`);
console.log(`Inactive or empty (safe to cut): ${inactive.length}`);
console.log(`Everything else (review these):  ${ordinary.length}`);

writeFileSync('cut-list.json', JSON.stringify(inactive, null, 2));
writeFileSync('review-list.json', JSON.stringify(ordinary, null, 2));
```

```bash
node sort-non-followers.js
```

Now you have a list you can defend, rather than a bulk action you will regret.

---

## Step 3 — Build a whitelist

Anyone you want to keep regardless: friends, clients, accounts you follow for
information rather than reciprocity, your own alt.

```js
const WHITELIST = ['alice_dev', 'bob_designs', 'some_client_account'];
```

The browser script takes this inline in its `CONFIG` block. For the CLI path,
filter them out of `cut-list.json` before running `bulk`, by adding this to the
sorting script above:

```js
const WHITELIST = new Set(['alice_dev', 'bob_designs', 'some_client_account']);
const cut = inactive.filter((a) => !WHITELIST.has(a.username));
writeFileSync('cut-list.json', JSON.stringify(cut, null, 2));
```

Either way, do it before you unfollow anything. Re-following someone is easy;
noticing that you unfollowed them is not.

---

## Step 4 — Unfollow, slowly

Three ways. Pick by how much control you want.

### Browser console (most control, no install)

1. Open `https://x.com/YOUR_USERNAME/following`
2. DevTools (<kbd>F12</kbd>) → **Console**
3. Paste [`scripts/unfollowback.js`](../scripts/unfollowback.js)

Configure it **before** you paste:

```js
const CONFIG = {
  maxUnfollows: 50,          // Start here. Not Infinity.
  whitelist: ['alice_dev', 'bob_designs', 'some_client_account'],
  dryRun: true,              // Leave true for the first run
  delay: 3000,               // 3s between actions
  scrollDelay: 2000,
  maxEmptyScrolls: 6,
  exportOnComplete: true,    // Downloads a JSON record. Keep this on.
};
```

Run once with `dryRun: true`. Read the output. It lists exactly who it would
unfollow. Only then set `dryRun: false` and run again.

Use [`scripts/unfollowWDFBLog.js`](../scripts/unfollowWDFBLog.js) instead if you
want a downloadable log of everyone removed.

### CLI

`bulk` takes the list you already saved and works through it with a checkpoint,
so an interrupted run resumes rather than restarting:

```bash
# Preview first. Nothing is unfollowed.
npx xactions bulk unfollow cut-list.json --dry-run

# Then for real, 3s apart
npx xactions bulk unfollow cut-list.json --delay 3000

# Interrupted? Pick up where it stopped.
npx xactions bulk unfollow cut-list.json --delay 3000 --resume
```

It accepts JSON, CSV, or a plain text file of handles, so you can hand-edit the
list before running it. That is usually worth doing.

### Ask an assistant, with a hand on the brake

If an assistant is driving through [MCP](02-mcp-with-claude.md), run the server
with `XACTIONS_MCP_REQUIRE_APPROVAL=1`. Every unfollow it decides on is held as a
draft rather than executed, and you release them yourself:

```bash
xactions drafts list
xactions drafts approve <id>
xactions drafts discard <id>
```

That is the difference between an assistant that suggests 400 unfollows and one
that performs them. See [Tutorial 02, step 7](02-mcp-with-claude.md#step-7--make-it-ask-before-it-acts).

### Ask an assistant

With the [MCP server](02-mcp-with-claude.md) configured:

> Find who I follow that doesn't follow me back. Exclude anyone with more than
> 10,000 followers and anyone in this list: alice_dev, bob_designs. Show me the
> result. Don't unfollow anyone yet.

Then, once you have read it:

> Unfollow the first 50 from that list, with a 3 second delay between each.

---

## Step 5 — Pace it

This is the part people skip.

X does not publish its automation limits, and they vary by account age, follower
count, and standing. What holds in practice:

- **50 in your first session.** See how your account reacts before scaling up.
- **A few hundred a day, maximum.** Unfollows, follows, likes, and deletes all
  draw on the same budget.
- **3000ms between actions.** Faster is not better here.
- **Spread it out.** 858 accounts is a week of sessions, not an afternoon.

**Stop immediately if buttons stop responding.** That is a soft throttle.
Continuing turns it into a temporary lock that costs you a day.

---

## Step 6 — Keep it clean

The reason people end up with 858 non-followers is that they only look once a
year. Snapshot your follower list on a schedule and diff it instead.

X does not expose who unfollowed you. The only way to know is to have recorded
who was following you yesterday, so the useful time to start is before you need
it:

```js
import { Scraper } from 'xactions/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const scraper = new Scraper();
await scraper.setCookies(`auth_token=${process.env.X_AUTH_TOKEN}; ct0=${process.env.X_CSRF_TOKEN}`);

const current = new Set();
for await (const follower of scraper.getFollowers(process.env.X_USERNAME, 5000)) {
  current.add(follower.username);
}

const previous = existsSync('followers.json')
  ? new Set(JSON.parse(readFileSync('followers.json', 'utf8')))
  : null;

if (previous) {
  const lost = [...previous].filter((u) => !current.has(u));
  const gained = [...current].filter((u) => !previous.has(u));
  console.log(`+${gained.length} / -${lost.length}`);
  if (lost.length) console.log('Unfollowed you:', lost.join(', '));
}

writeFileSync('followers.json', JSON.stringify([...current]));
```

Run it daily on a cron:

```
0 9 * * *  cd /path/to/project && node track-followers.js >> followers.log 2>&1
```

The self-hosted API server does this for you, storing snapshots and diffs in
PostgreSQL. See [docs/database.md](../docs/database.md#follower-history).

---

## What you learned

- Read the list before acting on it, always
- Sort by follower count and activity: it turns a number into a decision
- Whitelist first, unfollow second
- `dryRun: true` is the default for a reason
- 50 at a time, 3s apart, a few hundred a day
- Unfollower detection is snapshot diffing, so start recording now
- Let an agent do it only behind the draft-approval gate

## Next

- **[Tutorial 04 — Build a brand monitor](04-build-a-brand-monitor.md)**
- [Browser scripts](../docs/browser-scripts.md) — the full catalog
- [Example 06](../examples/06-find-non-followers.js) — this analysis as a program
