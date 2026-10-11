# 05: Read any account like an analyst

**Time:** 15 minutes
**You need:** XActions installed. **No X account, no login, no API key.**
**You end up with:** a defensible read on how any account actually performs, and how two accounts differ.

Everything in this tutorial runs on the guest tier. You never log in.

---

## The question

"How does this account actually do?" is usually answered with follower count, which is the least useful number available. Follower count tells you about the past. What you want to know is how often they post, what they post, how much of their audience reacts, and when.

XActions answers all of that from public data.

---

## 1. One account

```bash
xactions analyze NASA
```

By default it samples the last 50 posts. The report is dense, so here is what each block is telling you:

```
  Audience
  Followers:            92.4M  117 following
  Follower ratio:       789.4K
  Growth:               13.5K/day  lifetime average over 6,826 days
```

**Follower ratio** is followers divided by following. A high ratio means an account people seek out; a ratio near 1 usually means follow-for-follow growth. **Growth** is a lifetime average, so it flatters accounts that grew fast years ago. Treat it as an upper bound, not a current rate.

```
  Output
  Posts, lifetime:      74.2K  10.87/day
  Posts, sampled:       2.49/day  50 posts over 20.1 days
  Typical gap:          1.99h
  Last post:            7h ago
```

The two rates are the interesting part. Lifetime says 10.87/day; the recent sample says 2.49/day. This account posts a quarter as often now as it did on average across its life. One number would have hidden that entirely.

```
  Engagement
  Rate:                 0.007%  median original post, as a share of followers
  Median per post:      6,466.5  ♥ 5,426.5  ↻ 813  💬 176.5
  Best in sample:       20.9K
  Median views:         1.2M  0.44% of viewers interact, n=20
```

(`n=20` is how many sampled posts reported a view count. A small `n` there means the view-rate figure is directional, not precise.)

**Median, not mean.** One viral post drags a mean anywhere; the median tells you what a typical post does. The engagement rate looks tiny because it is measured against 92 million followers, which is why the views-based number underneath it matters more: 0.44% of the people who actually saw the post interacted with it.

```
  Content mix
  Original:             36%  replies 0%  reposts 60%  quotes 4%
  With media:           80%  links 75%  hashtags 0%
```

Three fifths of this account's output is reposts, and zero percent is replies. That is a curation feed, not a conversation. If you are studying it to copy the strategy, that distinction matters more than any engagement number.

```
  Timing (UTC)
  00              ▅▅▂█▅▂▆▁▆ 23
  Best hour:            17:00  median 8,692
  Best weekday:         Thursday  median 8,377
```

The sparkline is engagement by hour of day, UTC, across the sample. Sample more posts for a more trustworthy peak:

```bash
xactions analyze NASA --limit 200
```

## 2. Two accounts, side by side

`analyze` takes several usernames and compares them:

```bash
xactions analyze NASA SpaceX
```

Read the comparison in this order:

1. **Posting cadence.** Who ships more? A 5x cadence difference explains most engagement differences on its own.
2. **Content mix.** Original versus repost versus reply. These are different businesses.
3. **Engagement per view.** The only figure that is fair across wildly different follower counts.
4. **Best hour.** If two accounts serve the same audience and peak at different hours, one of them is wrong.

## 3. Whose followers overlap

```bash
xactions audience NASA SpaceX --max 2000
```

This is the one command on this page that needs a session, because follower lists are not on the guest tier. Run `xactions connect` first if `xactions doctor` says you are guest-only.

Overlap answers a question analysis of a single account cannot: is this a shared audience or two separate ones? High overlap means you are choosing between two accounts for the same people. Low overlap means there is an audience you are not reaching.

`--max` caps how many followers are fetched per account. Start at 2000. Raising it improves the estimate and costs time linearly.

## 4. Keep the raw numbers

Every command above takes `--output`, and the format follows the extension:

```bash
xactions analyze NASA --limit 200 --output nasa.json
xactions analyze NASA --limit 200 --output nasa.csv
xactions analyze NASA --limit 200 --output nasa.xlsx
```

Or take JSON on stdout and cut it yourself:

```bash
xactions analyze NASA --json | jq '{
  followers:   .audience.followers,
  ratio:       .audience.followerRatio,
  postsPerDay: .output.postsPerDay,
  lifetime:    .output.lifetimePostsPerDay,
  median:      .engagement.medianPerOriginal,
  viewRate:    .engagement.viewRate,
  originals:   .mix.originalShare,
  bestHour:    .timing.bestHourUTC,
  bestWeekday: .timing.bestWeekday
}'
```

```json
{
  "followers": 92356555,
  "ratio": 789372.26,
  "postsPerDay": 2.49,
  "lifetime": 10.87,
  "median": 6466.5,
  "viewRate": 0.44,
  "originals": 36,
  "bestHour": 17,
  "bestWeekday": "Thursday"
}
```

The top-level keys are `identity`, `audience`, `output`, `engagement`, `mix`, `timing`, `topPosts`, `topHashtags`, `topMentions`, `meta`, and `signals`. Run `xactions analyze NASA --json | jq 'keys'` to see them, and `jq '.engagement'` to open any one up.

`signals` is the observations block from the formatted report, as data:

```bash
xactions analyze NASA --json | jq -r '.signals[] | "\(.level | ascii_upcase): \(.title)"'
```

```
GOOD: Followed far more than it follows
WATCH: Engagement rate of 0.007%
WATCH: 60% of the timeline is retweets
GOOD: 80% of posts carry media
INFO: Best hour is 17:00 UTC
GOOD: Averaging 13.5K new followers a day
```

`timing.byHourUTC` is the 24-entry array behind the sparkline, so you can find the peak yourself over a large sample:

```bash
xactions analyze NASA --json \
  | jq -r '.timing.byHourUTC | max_by(.medianEngagement) | "best hour \(.index):00 UTC, median \(.medianEngagement)"'
```

```
best hour 17:00 UTC, median 8692
```

`timing.bestHourUTC` is `null` when no single hour cleared `timing.minimumBucketSample` posts, and the formatted report says "not enough data" rather than inventing a peak. Raise `--limit` until it resolves; the sparkline is readable either way.

## 5. One line per record, for agents and pipes

`--json` is the right shape for `jq`. It is the wrong shape for an LLM, which
pays for every brace. `--compact` prints one record per line as tab-separated
`key=value` pairs, with no colours and no spinner:

```bash
xactions profile NASA --compact
```

```
id=11348282	username=NASA	name=NASA	followers=92356563	following=117	tweets=74197	verified=false	bio=Making the seemingly impossible, possible. ✨
```

`--fields` narrows it to the columns you actually want:

```bash
xactions tweets NASA --limit 3 --compact --fields id,likes,text
```

```
id=2093063226351136958	likes=1639	text=Join us tomorrow at 11am ET (1500 UTC) as the Artemis II crew receives the Congressional Space Medal of Honor! ...
id=2092962731666051534	likes=0	text=RT @LearnWithNASA: Space telescopes help us understand the origins of the universe. ...
id=2092744659667673582	likes=6753	text=A partial lunar eclipse will pass over the Americas ...
```

Both are global flags, so they work on any command that emits records. One line
per record also means `cut`, `awk`, and `grep` work without a JSON parser in the
pipeline.

## 6. Track it over time

A single report is a snapshot. The interesting signal is the change:

```bash
# Take a reading every day, keyed by date
xactions analyze NASA --limit 200 --output "reports/nasa-$(date -u +%F).json"
```

Put that in cron and after two weeks you have a series. XActions also has a built-in version of this:

```bash
xactions snapshot NASA          # start auto-snapshotting
xactions history NASA           # read the series back
```

## 7. A comparison script

```bash
#!/usr/bin/env bash
# compare.sh handle1 handle2 ... — one row per account, sorted by engagement.
set -euo pipefail

printf '%-20s %12s %10s %12s %8s\n' ACCOUNT FOLLOWERS POSTS/DAY MED_ENGAGE BEST_HR

for handle in "$@"; do
  xactions analyze "$handle" --limit 100 --json 2>/dev/null | jq -r --arg h "$handle" '
    [$h,
     (.audience.followers          // 0 | tostring),
     (.output.postsPerDay          // 0 | tostring),
     (.engagement.medianPerOriginal // 0 | tostring),
     (.timing.bestHourUTC          // "?" | tostring)]
    | @tsv'
done | sort -k4 -rn | awk -F'\t' '{ printf "%-20s %12s %10s %12s %8s\n", $1, $2, $3, $4, $5 }'
```

```bash
chmod +x compare.sh
./compare.sh NASA SpaceX
```

```
ACCOUNT                 FOLLOWERS  POSTS/DAY   MED_ENGAGE  BEST_HR
SpaceX                   41896750       2.96        10377       21
NASA                     92356691       2.44       4088.5       17
```

Twice the followers, half the engagement per post, and a different peak hour.
That row is the whole point of the exercise.

Run it against your own account and the five accounts you compete with. The row that surprises you is the one worth investigating.

---

## What you learned

- Why median beats mean, and why engagement-per-view beats engagement-per-follower
- That lifetime and recent cadence disagreeing is itself the finding
- How content mix identifies what kind of account you are actually looking at
- Turning reports into files, JSON, and a time series you can track
- `--compact` and `--fields` when the consumer is an agent or a shell, not you

## Next

- [06: Everything is JSON](06-everything-is-json.md) to script all of this properly
- [04: Build a brand monitor](04-build-a-brand-monitor.md) to watch continuously instead of on demand
- [CLI reference](../docs/cli-reference.md) for every flag on every command
