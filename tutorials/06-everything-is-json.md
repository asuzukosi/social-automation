# 06: Everything is JSON

**Time:** 20 minutes
**You need:** XActions installed, plus [`jq`](https://jqlang.github.io/jq/). No login for most of this.
**You end up with:** XActions as a component in your own pipelines rather than a thing you type at.

---

## The idea

XActions prints a formatted report because that is what you want when you are looking at it. Add `--json` and it prints data instead, and stdout carries nothing else. That single rule is what makes everything below possible: no spinner text, no colour codes, no "Fetching..." line to strip.

```bash
xactions profile NASA --json | jq -r .name
```
```
NASA
```

Progress output goes to stderr, so a pipe never has to filter it. That also means you keep seeing progress while piping:

```bash
xactions tweets NASA --limit 200 --json > tweets.json    # progress still shows on your terminal
xactions tweets NASA --limit 200 --json 2>/dev/null      # silence it if you prefer
```

## 1. Tab completion first

Before writing anything, make the CLI type itself:

```bash
# bash
echo 'source <(xactions completion bash)' >> ~/.bashrc && exec bash

# zsh
echo 'source <(xactions completion zsh)' >> ~/.zshrc && exec zsh

# fish
xactions completion fish > ~/.config/fish/completions/xactions.fish
```

Now `xactions <tab>` lists all 56 top-level commands, `xactions plugin <tab>` lists its sub-commands, and `xactions tweets --<tab>` lists that command's flags. The script is generated from the live command tree, so regenerate it after upgrading and it picks up whatever is new.

## 2. When the reader is an agent, not jq

`--json` is the right shape for a parser. It is the wrong shape for an LLM,
which pays per token for every brace and quote. `--compact` prints one record
per line, tab-separated `key=value`, no colours and no spinner:

```bash
xactions profile NASA --compact
```
```
id=11348282	username=NASA	name=NASA	followers=92356563	following=117	tweets=74197	verified=false	bio=Making the seemingly impossible, possible. ✨
```

`--fields` narrows it to the columns you asked for:

```bash
xactions tweets NASA --limit 3 --compact --fields id,likes,text
```
```
id=2093063226351136958	likes=1639	text=Join us tomorrow at 11am ET (1500 UTC) as the Artemis II crew receives the Congressional Space Medal of Honor! ...
id=2092962731666051534	likes=0	text=RT @LearnWithNASA: Space telescopes help us understand the origins of the universe. ...
id=2092744659667673582	likes=6753	text=A partial lunar eclipse will pass over the Americas ...
```

Both are **global** flags: put them before or after the sub-command and they
work on anything that emits records. One record per line also means `cut`,
`awk`, `grep`, and `sort` work with no JSON parser in the pipeline:

```bash
xactions tweets NASA --limit 100 --compact --fields id,likes \
  | sort -t= -k3 -rn | head -5
```

## 3. Reading a timeline

```bash
xactions tweets NASA --limit 100 --json > tweets.json

# What does one post look like?
jq '.[0]' tweets.json

# Just the text
jq -r '.[].text' tweets.json

# Sorted by likes, top 5
jq -r 'sort_by(-.likes)[:5] | .[] | "\(.likes)\t\(.text[0:70])"' tweets.json
```

Find the field names rather than guessing them:

```bash
jq '.[0] | keys' tweets.json
```

```
["bookmarkCount","conversationId","fullText","hashtags","id","inReplyToStatusId",
 "isQuote","isReply","isRetweet","likes","mentions","permanentUrl","photos","place",
 "poll","quotedStatusId","replies","retweets","sensitiveContent","text","timeParsed",
 "timestamp","urls","userId","username","videos","views"]
```

Three worth knowing up front. Media is split into `photos` and `videos`, with no combined `media` array. `timestamp` is **milliseconds** while `timeParsed` is an ISO string. And build post links from the id rather than reading `permanentUrl`:

```bash
jq -r '.[] | "https://x.com/i/web/status/\(.id)"' tweets.json
```

`permanentUrl` is composed from the author's handle, and X does not always send a handle on a timeline entry, so it can come back as an empty string. The `/i/web/status/<id>` form needs only the id and redirects to the real permalink, so it always resolves.

## 4. Filtering

`jq` does the filtering, which means you are not limited to flags anyone thought to add.

```bash
# Posts carrying media
jq '[.[] | select(((.photos | length) + (.videos | length)) > 0)] | length' tweets.json

# Original posts only, no reposts or replies
jq '[.[] | select(.isRetweet == false and .isReply == false)] | length' tweets.json

# Posts above 5000 likes, with their links
jq -r '.[] | select(.likes > 5000) | "https://x.com/i/web/status/\(.id)"' tweets.json

# Posts mentioning a word, case insensitive
jq -r '.[] | select(.text | ascii_downcase | contains("launch")) | .text' tweets.json

# Every link ever posted, deduplicated
jq -r '[.[].urls] | flatten | unique | .[]' tweets.json

# Engagement rate per post, best first
jq -r 'map(select(.views > 0))
       | sort_by(-((.likes + .retweets + .replies) / .views))[:5][]
       | "\((((.likes + .retweets + .replies) / .views) * 100) | .*100 | round / 100)%\t\(.text[0:60])"' tweets.json
```

## 5. Combining commands

Pipelines get interesting when one command feeds another. Find who an account talks about, then look each of them up:

```bash
xactions analyze NASA --limit 200 --json \
  | jq -r '.topMentions[:5][] | .value' \
  | while read -r handle; do
      xactions profile "$handle" --json 2>/dev/null \
        | jq -r '"\(.username)\t\(.followersCount // 0)\t\(.bio // "" | .[0:60])"'
    done \
  | column -t -s $'\t'
```

```
Space_Station  8898049  NASA's page for the latest mission and science updates from
NASARoman      48312    The Roman Telescope is a NASA mission that will study dark e
Astro_ChrisW   12576    @NASA Astronaut, Group 23  |  Expedition 74 Flight Engineer
astro_anil     16501    NASA Astronaut aboard the ISS | Soyuz launch from Kaza
NASAHubble     8903796  The official X account for the NASA Hubble Space Telescope,
```

`topMentions` and `topHashtags` are arrays of `{value, count}`, not bare strings. Check a shape before you build on it:

```bash
xactions analyze NASA --json | jq '.topMentions[0]'
```
```json
{
  "value": "NASARoman",
  "count": 4
}
```

## 6. CSV and spreadsheets without jq

For the common cases the CLI writes the file for you. The format follows the extension:

```bash
xactions tweets NASA --limit 500 --output nasa.csv
xactions tweets NASA --limit 500 --output nasa.xlsx
xactions followers NASA --limit 1000 --output followers.csv     # needs a session
```

Straight into Google Sheets:

```bash
xactions tweets NASA --limit 500 \
  --google-sheets <spreadsheet-id> \
  --sheet-name "NASA" \
  --sheet-mode replace
```

`--sheet-mode` takes `append`, `replace`, or `new-sheet`.

## 7. Exit codes

The read commands exit non-zero on failure, so `set -e` and `&&` behave:

```bash
if xactions profile somehandle --json > /dev/null 2>&1; then
  echo "account exists and is readable"
else
  echo "not readable: private, suspended, or does not exist"
fi
```

`xactions doctor` is the one to reach for in CI: it exits non-zero when something is actually broken, so a scheduled job can check its own footing before doing work.

```bash
xactions doctor || { echo "XActions is not healthy, skipping run"; exit 1; }
```

`xactions quickstart --json` reports the machine's setup state as data, which is the cheaper check when all you need to know is whether a session exists:

```bash
tier=$(xactions quickstart --json | jq -r .tier)
[ "$tier" = "session" ] || echo "guest tier: search and followers will not work"
```

## 8. A daily digest

Putting it together. This runs on the guest tier, needs no account, and mails you nothing you did not ask for:

```bash
#!/usr/bin/env bash
# digest.sh — top posts from the accounts you follow professionally.
set -euo pipefail

ACCOUNTS=(NASA SpaceX)
SINCE=$(date -u -d '24 hours ago' +%s 2>/dev/null || date -u -v-24H +%s)
OUT="digest-$(date -u +%F).md"

xactions doctor > /dev/null || { echo "xactions unhealthy"; exit 1; }

{
  echo "# Digest for $(date -u +%F)"
  echo

  for handle in "${ACCOUNTS[@]}"; do
    echo "## @${handle}"
    echo

    # `timestamp` is milliseconds, so the cutoff is compared in milliseconds too.
    # jq exits 0 on an empty result, so test the output rather than the status:
    # "no posts today" is a normal day, not a failure.
    posts=$(xactions tweets "$handle" --limit 50 --json 2>/dev/null \
      | jq -r --argjson since "$((SINCE * 1000))" '
          [ .[]
            | select(.timestamp != null and .timestamp > $since)
            | select(.isRetweet == false)
          ]
          | sort_by(-(.likes // 0))
          | .[:3][]
          | "- **\(.likes // 0) likes** \(.text | gsub("\n"; " ") | .[0:160])\n  https://x.com/i/web/status/\(.id)"
        ')

    if [ -n "$posts" ]; then echo "$posts"; else echo "_no posts in the last 24h_"; fi

    echo
  done
} > "$OUT"

echo "wrote $OUT"
```

```bash
chmod +x digest.sh && ./digest.sh
```

```
wrote digest-2026-08-28.md
```

```markdown
# Digest for 2026-08-28

## @NASA

- **1691 likes** Join us tomorrow at 11am ET (1500 UTC) as the Artemis II crew receives the Congressional Space Medal of Honor! We'll be streaming the ceremony here, on our YouT
  https://x.com/i/web/status/2093063226351136958

## @SpaceX

_no posts in the last 24h_
```

Then put it in cron:

```cron
0 8 * * * cd /home/you/digests && ./digest.sh >> digest.log 2>&1
```

## 9. When you want a library instead of a pipe

Once the shell script grows conditionals, move to Node. The same data, one import:

```javascript
import { Scraper } from 'xactions/client';

const scraper = new Scraper();

const profile = await scraper.getProfile('NASA');
console.log(profile.name, profile.followersCount);

// getTweets is an async generator, not a promise for an array. It pages under
// the hood and yields as results arrive, so `break` costs nothing and memory
// stays flat no matter how big the account is.
const tweets = [];
for await (const tweet of scraper.getTweets('NASA', 100)) {
  tweets.push(tweet);
}
console.log(`${tweets.length} posts`);
```

`getFollowers`, `getFollowing`, and `searchTweets` are generators too. Awaiting one directly hands you the generator object, not the data, which is the single most common mistake when moving from the CLI to the library.

The HTTP client is the same one the CLI uses for guest-tier reads: no browser, no Chromium download.

---

## What you learned

- `--json` puts data on stdout and nothing else, so pipes are always safe
- Progress goes to stderr, so you keep it while redirecting
- `jq` filters beat waiting for someone to add a flag
- Exit codes make XActions safe inside `set -e` scripts and cron
- `--compact` and `--fields` are the agent-shaped output: one record per line, no braces
- `--output` handles CSV, XLSX, and Google Sheets without any jq at all
- Generators, not arrays: `for await`, never `await scraper.getTweets(...)`

## Next

- [05: Read any account like an analyst](05-competitive-intelligence.md) if you skipped it
- [04: Build a brand monitor](04-build-a-brand-monitor.md) to run continuously instead of on a schedule
- [CLI reference](../docs/cli-reference.md) for every flag
- [REST API](../docs/rest-api.md) if you want this over HTTP instead
