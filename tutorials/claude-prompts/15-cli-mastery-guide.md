# Tutorial: XActions CLI Mastery — Command Line Power User Guide

You are my CLI tool expert. I want to master the XActions command-line interface for maximum productivity. Walk me through the commands I will actually use, every flag that matters, and the workflows that string them together. I want to be able to do everything from my terminal.

## Context

I'm using XActions (https://github.com/nirholas/XActions), an open-source X/Twitter toolkit with a full CLI (`xactions` command) built on Commander.js. It has 56 top-level commands, most with sub-commands of their own.

Two things to know before anything else, because they explain most of what follows:

**There are two tiers.** Profiles and public timelines are the guest tier and need no account at all. Search, followers, following, likes, bookmarks, and DMs are the session tier and need a login. A logged-out request to a session-tier endpoint comes back as a bare `404`, which reads like a bug and is not one.

**There are two engines.** Most read commands (`profile`, `tweets`, `analyze`, `search`, `followers`) use a plain HTTP client against X's internal GraphQL API: fast, no browser. A few (`media`, and the write-side automation) drive real Chromium through Puppeteer, which is slower and needs a session.

## What I Need You To Do

### Part 1: Installation and setup

1. **Install globally:**
   ```bash
   npm install -g xactions
   ```
   Or run it without installing:
   ```bash
   npx xactions <command>
   ```

2. **See where you stand before doing anything:**
   ```bash
   xactions doctor
   ```
   It checks Node, Chromium, the MCP server, installed skills, the cached GraphQL query IDs, whether the guest tier works right now (it reads a real profile to find out), and whether a saved session exists and is still valid. Every problem it reports comes with the command that fixes it. It exits non-zero when something is genuinely broken, so a cron job can check itself before doing work.

   `xactions quickstart` is the friendlier walkthrough of the same ground, and `xactions quickstart --json` reduces it to `{"tier":"guest"}` or `{"tier":"session"}` for a script.

3. **Log in.** Three ways, easiest first:
   ```bash
   xactions connect                        # opens a real browser, you log in, it captures the session
   xactions login --from-browser chrome    # reads x.com cookies from a browser you are already in
   xactions login                          # paste auth_token and ct0 by hand
   ```
   `--from-browser` accepts `chrome`, `chromium`, `brave`, `edge`, `arc`, or `firefox`, and defaults to firefox. Already have a cookie file? `xactions login --cookies-file <path>` reads Netscape `cookies.txt`, Cookie-Editor or EditThisCookie JSON, a Playwright or Puppeteer `storageState`, or a raw `auth_token=...; ct0=...` string.

   **You need both cookies.** `auth_token` says who you are; `ct0` is the CSRF token X requires as a header before it treats the request as logged in. With only the first, session-tier endpoints keep answering 404. This is the single most common setup mistake.

   The session is written to `~/.xactions/cookies.json`, with a fallback copy in `~/.xactions/config.json`. Every other command reads it from there.

4. **Verify:**
   ```bash
   xactions doctor
   ```
   The "Session tier" block should now say the session is saved and valid.

5. **Log out:**
   ```bash
   xactions logout
   ```

### Part 2: Output flags, which are global

These work on every command that emits records, and learning them once saves repeating yourself for the rest of this guide. **There is no `--format` flag.** Three mechanisms cover the same ground:

```bash
# 1. --json puts data on stdout and nothing else. Progress goes to stderr,
#    so a pipe is always clean and you still see progress while redirecting.
xactions profile NASA --json | jq -r .name

# 2. --output writes a file, and the extension picks the format: .json, .csv, .xlsx
xactions tweets NASA --limit 500 --output nasa.csv
xactions tweets NASA --limit 500 --output nasa.xlsx

# 3. --compact prints one record per line as tab-separated key=value pairs,
#    with no colours and no spinner. This is the shape to hand an LLM.
xactions profile NASA --compact
```
```
id=11348282	username=NASA	name=NASA	followers=92356563	following=117	tweets=74197	verified=false	bio=Making the seemingly impossible, possible. ✨
```

`--fields` narrows `--compact` to the columns you want:

```bash
xactions tweets NASA --limit 3 --compact --fields id,likes,text
```
```
id=2093063226351136958	likes=1639	text=Join us tomorrow at 11am ET (1500 UTC) as the Artemis II crew ...
id=2092962731666051534	likes=0	text=RT @LearnWithNASA: Space telescopes help us understand the ...
id=2092744659667673582	likes=6753	text=A partial lunar eclipse will pass over the Americas ...
```

One record per line means `cut`, `awk`, `grep`, and `sort` work with no JSON parser in the pipeline.

Straight to a spreadsheet, on the commands that support it:

```bash
xactions followers NASA --limit 1000 \
  --google-sheets <spreadsheet-id> --sheet-name "Followers" --sheet-mode replace
```

`--sheet-mode` takes `append`, `replace`, or `new-sheet`.

### Part 3: Profile scraping

```bash
xactions profile <username>
```

No login needed.

```bash
xactions profile NASA                       # formatted report
xactions profile NASA --json | jq .         # the full object
xactions profile NASA --compact             # one line, for an agent
```

```
⚡ @NASA

  Name:      NASA
  Bio:       Making the seemingly impossible, possible. ✨
  Location:  Pale Blue Dot
  Website:   http://www.nasa.gov/
  Joined:    2007-12-19
  Following: 117  Followers: 92.4M
  Tweets:    74.2K  Listed:    0
  ✓ Verified
```

### Part 4: Timeline scraping

```bash
xactions tweets <username> [-l|--limit N] [-o|--output file] [--json]
```

No login needed. `--limit` defaults to 100.

```bash
xactions tweets NASA --limit 100 --output nasa.json
xactions tweets NASA --limit 200 --json | jq 'sort_by(-.likes) | .[:5]'
xactions tweets NASA --limit 50 --output nasa.csv
```

**Build post links from the id**, not from `permanentUrl`: X does not always send the author's handle on a timeline entry, so `permanentUrl` can be empty, while `https://x.com/i/web/status/<id>` needs only the id and always redirects to the real permalink.

```bash
xactions tweets NASA --limit 40 --json | jq -r '.[] | "https://x.com/i/web/status/\(.id)"'
```

Related: `xactions thread <url>` unrolls a full thread, and `xactions analyze <username>` produces a whole account report (engagement rate, cadence, content mix, best posting hour) in one command, also with no login.

### Part 5: Follower and following scraping

```bash
xactions followers <username> [-l|--limit N] [-o|--output file] [--json]
xactions following <username> [-l|--limit N] [-o|--output file] [--json]
```

**Session tier.** `--limit` defaults to 100.

```bash
xactions followers myusername --limit 200 --output my-followers.csv
xactions following myusername --limit 500 --output my-following.json
xactions followers elonmusk --limit 50 --json | jq -r '.[].username'
```

### Part 6: Find non-followers

The command XActions is best known for:

```bash
xactions non-followers <username> [-l|--limit N] [-o|--output file] [--json]
```

**Session tier.** `--limit` defaults to 500, which is not enough for most accounts.

```bash
xactions non-followers myusername --limit 5000 --output unfollowers.json
xactions non-followers myusername --limit 5000 --json | jq 'length'
xactions non-followers myusername --limit 5000 --json | jq -r '.[].username' > handles.txt
```

It only reads. Acting on the list is `xactions bulk unfollow`, and doing that as a separate, deliberate step is the point.

### Part 7: Search

```bash
xactions search "<query>" [-l|--limit N] [-f|--filter type] [-o|--output file] [--json]
```

**Session tier.** `--filter` takes `latest`, `top`, `people`, `photos`, or `videos` and defaults to `latest`.

```bash
xactions search "machine learning" --limit 50
xactions search "from:elonmusk AI" --limit 100 --json
xactions search "#buildinpublic" --filter top --limit 50
xactions search "\"startup funding\" min_faves:100 -filter:replies lang:en"
xactions search "@myusername" --limit 200 --output mentions.json
xactions search "AI startups since:2026-01-01" --limit 100
```

X's own search operators all work, because the query string is passed through unchanged.

### Part 8: Hashtags

```bash
xactions hashtag "<tag>" [-l|--limit N] [-o|--output file] [--json]
```

**Session tier**, since it is search underneath.

```bash
xactions hashtag "web3" --limit 100 --json
xactions hashtag "AI" --limit 50 --output ai-tweets.json
xactions hashtag "machinelearning" --limit 50 --output ml-tweets.json
jq -s 'flatten | sort_by(-.likes)' ai-tweets.json ml-tweets.json
```

`xactions hashtags "<tweet text>"` is a different command: it suggests hashtags for a draft.

### Part 9: Threads

```bash
xactions thread "<tweet-url>" [-o|--output file] [--json]
```

```bash
xactions thread "https://x.com/user/status/123456"
xactions thread "https://x.com/user/status/123456" --output thread.json
```

The extension on `--output` picks the format.

### Part 10: Media

```bash
xactions media <username> [-l|--limit N] [-o|--output file] [--json]
```

**Session tier, and browser-driven.** This is one of the Puppeteer commands: it launches Chromium and reads the profile's media tab. Logged out it returns an empty array rather than an error, so if you get `[]` from a prolific account, that is the symptom of a missing session, not an empty profile.

### Part 11: Reading your own X data export

Completely offline, no login, nothing leaves the machine. Request the zip from x.com (**Settings and privacy → Your account → Download an archive of your data**) and point XActions at it:

```bash
xactions archive summary twitter-2026-08-28.zip              # counts, date range, top hashtags
xactions archive summary twitter-2026-08-28.zip --json       # the same as data
xactions archive export twitter-2026-08-28.zip --out mine    # JSON + CSV + Markdown + a browsable index.html
xactions archive migrate twitter-2026-08-28.zip --to bluesky --out staged   # dry run by default
```

`--sections tweets,likes` limits what is read, which matters on a large archive. `--formats json,md` limits what is written. Full walkthrough: [tutorial 07](../07-your-x-archive.md).

### Part 12: Bulk actions from a file

```bash
xactions bulk <action> <file> [--delay ms] [--dry-run] [--resume]
```

**Session tier.** Actions: `follow`, `unfollow`, `block`, `mute`, `scrape`. The file can be JSON, CSV, or a plain text list of handles, so you can hand-edit it first, which is usually worth doing.

```bash
xactions bulk unfollow cut-list.json --dry-run          # preview, nothing happens
xactions bulk unfollow cut-list.json --delay 3000       # for real, 3s apart
xactions bulk unfollow cut-list.json --delay 3000 --resume   # pick up after an interruption
```

Start at 50 actions in your first session and stay under a few hundred a day. Follows, unfollows, likes, and deletes all draw on the same budget, and X does not publish where the line is.

### Part 13: Reviewing what an AI agent wants to do

If an assistant drives XActions through MCP, run the server with `XACTIONS_MCP_REQUIRE_APPROVAL=1` and every write is held as a draft instead of executed. Reads are untouched. You release them from the terminal:

```bash
xactions drafts list                  # everything waiting, newest first
xactions drafts list --status pending
xactions drafts show <id>             # one draft with its full arguments
xactions drafts approve <id>          # run it exactly as the agent submitted it
xactions drafts discard <id>          # delete it without running it
xactions drafts clear                 # drop executed and failed ones, keep pending
```

```
  ID        STATUS    AGE       TOOL                      ARGS
  88aae55b  pending   just now  x_post_tweet              text="A post an agent proposed. Never sent."

  1 draft, 1 pending. Approve one with `xactions drafts approve <id>`, everything with `--all`.
```

Drafts live in `~/.xactions/mcp-drafts.json`.

### Part 14: Agent skills

```bash
xactions skills list                              # all 49, and where each is installed
xactions skills show follower-monitoring          # print one without installing it
xactions skills install --all --global            # every skill, under your home directory
xactions skills install follower-monitoring       # one skill, into ./.claude/skills
xactions skills install --all --target cursor     # or codex, windsurf, project
xactions skills uninstall --all
```

Skills are plain markdown procedures ("which tools, in what order, with what rate limits"), so they work with any assistant, MCP or not.

### Part 15: Setting up an MCP client

```bash
xactions mcp-config
```

Prints the JSON block for Claude Desktop, Cursor, Windsurf, and the rest, with the right paths for your machine, so you are not hand-writing it.

### Part 16: Tab completion

```bash
# bash
echo 'source <(xactions completion bash)' >> ~/.bashrc && exec bash

# zsh
echo 'source <(xactions completion zsh)' >> ~/.zshrc && exec zsh

# fish
xactions completion fish > ~/.config/fish/completions/xactions.fish
```

The script is generated from the live command tree, so regenerate it after upgrading and it picks up whatever is new. `xactions <tab>` then lists all 56 top-level commands, `xactions drafts <tab>` lists that command's sub-commands, and `xactions tweets --<tab>` lists its flags.

### Part 17: Advanced CLI workflows

#### Workflow 1: Find and export non-followers for review
```bash
xactions non-followers myusername --limit 5000 --output nonfollowers.json
jq 'length' nonfollowers.json
jq -r '.[] | select((.followersCount // 0) < 10000) | .username' nonfollowers.json > cut-list.txt
head -20 cut-list.txt
xactions bulk unfollow cut-list.txt --dry-run
```

#### Workflow 2: Competitor report, no login required
```bash
mkdir -p reports
for user in NASA SpaceX; do
  xactions analyze "$user" --limit 200 --output "reports/$user.json"
done

jq -s -r '.[] | "\(.identity.username)\t\(.audience.followers)\t\(.output.postsPerDay)\t\(.engagement.medianPerOriginal)"' \
  reports/*.json | column -t
```

#### Workflow 3: Niche research
```bash
mkdir -p research
for kw in "ai startup" "machine learning" "deep learning"; do
  xactions search "$kw" --limit 30 --output "research/$(echo "$kw" | tr ' ' '-').json"
done

jq -s 'flatten
       | group_by(.username)
       | map({user: .[0].username, posts: length, likes: (map(.likes // 0) | add)})
       | sort_by(-.likes)
       | .[:20]' research/*.json
```

#### Workflow 4: Daily metrics tracking
```bash
#!/usr/bin/env bash
# daily-metrics.sh
set -euo pipefail
DATE=$(date -u +%F)
mkdir -p snapshots

xactions doctor > /dev/null || { echo "xactions unhealthy, skipping"; exit 1; }

xactions followers myusername --limit 1000 --output "snapshots/$DATE-followers.json"
xactions following myusername --limit 1000 --output "snapshots/$DATE-following.json"

today=$(jq 'length' "snapshots/$DATE-followers.json")
echo "$DATE: $today followers"

YESTERDAY=$(date -u -d "yesterday" +%F 2>/dev/null || date -u -v-1d +%F)
if [ -f "snapshots/$YESTERDAY-followers.json" ]; then
  yday=$(jq 'length' "snapshots/$YESTERDAY-followers.json")
  echo "Change: $((today - yday)) followers"

  # X does not tell you who unfollowed. Diffing yesterday's snapshot is the only way.
  jq -r --slurpfile old "snapshots/$YESTERDAY-followers.json" \
    '[.[].username] as $now | $old[0] | map(.username) | map(select(. as $u | $now | index($u) | not)) | .[]' \
    "snapshots/$DATE-followers.json"
fi
```

XActions has a built-in version of this too: `xactions snapshot <username>` starts auto-snapshotting and `xactions history <username>` reads the series back.

#### Workflow 5: Content performance report
```bash
xactions tweets myusername --limit 100 --json \
  | jq -r 'sort_by(-((.likes // 0) + (.retweets // 0) + (.replies // 0)))
           | .[:10][]
           | "\(.likes + .retweets + .replies)\t\(.text[0:70])\thttps://x.com/i/web/status/\(.id)"' \
  | column -t -s $'\t'
```

### Part 18: Environment variables

```bash
# Session cookie, as an alternative to the login command
export XACTIONS_SESSION_COOKIE="your_auth_token_here"
export XACTIONS_CSRF_TOKEN="your_ct0_here"

# Where XActions keeps its state (cookies, drafts, query-ID cache, snapshots).
# Default: ~/.xactions
export XACTIONS_HOME="$HOME/.xactions"

# MCP server: hold every write tool as a draft instead of running it
export XACTIONS_MCP_REQUIRE_APPROVAL=1
```

### Part 19: Troubleshooting

Run `xactions doctor` first, every time. It names the fix for most of what follows.

1. **"Command not found"** — `npm install -g xactions`, or use `npx xactions`.

2. **A `404` from `search`, `followers`, `following`, or `non-followers`** — that is X refusing a session-tier endpoint to a logged-out request. Not a bug, not a bad handle. Run `xactions connect`.

3. **Search works but followers do not, or the reverse** — you probably have `auth_token` without `ct0`. Both cookies, always.

4. **Results come back empty rather than erroring** — `media` returns `[]` without a session. For everything else, the account may be protected or suspended.

5. **"Rate limited"** — guest tokens are throttled hard, so logging in raises the ceiling substantially quite apart from unlocking the session tier. Back off and retry; the error carries `rateLimitReset`.

6. **Puppeteer or Chromium errors** — only the browser-driven commands need it. `npx puppeteer browsers install chrome`, or stay on the HTTP commands (`profile`, `tweets`, `analyze`, `thread`).

7. **Slow runs** — lower `--limit`. The HTTP commands page as they go, so a smaller limit really is proportionally faster.

## My CLI Goals
(Replace before pasting)
- Am I comfortable with the command line? Beginner/Intermediate/Advanced
- What do I mainly want to do? Scraping / Analysis / Automation
- Do I want to build automated scripts? Yes/No
- Preferred output: `--json` for jq / `--output` files / `--compact` for an agent / the formatted report

Start with Part 1 — help me install, run `xactions doctor`, and read the result, then walk me through my first commands.
