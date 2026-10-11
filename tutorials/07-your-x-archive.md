# 07: Read your own X archive

**Time:** 15 minutes
**You need:** your X data export. **No login, no API key, and nothing leaves your machine.**
**You end up with:** your whole account as JSON, CSV, Markdown and a browsable HTML page, and a staged migration to Bluesky or Mastodon.

Everything else in these tutorials reads X over the network. This one reads the
file X gives you, which is the one copy of your account that nobody can rate
limit, suspend, or take away.

---

## 1. Ask X for the export

X does not hand it over instantly. Request it first, then come back:

1. x.com → **Settings and privacy** → **Your account** → **Download an archive of your data**
2. Confirm your password, then confirm the code X sends you.
3. Wait. X takes anywhere from a few hours to a couple of days.
4. Download the zip when the notification arrives. It is called something like
   `twitter-2026-08-28-a1b2c3....zip`.

Do not unzip it. XActions reads the zip directly, and an unzipped archive is
just as good if you already opened it.

## 2. See what is in there

```bash
xactions archive summary twitter-2026-08-28.zip
```

```
✔ Read twitter-2026-08-28.zip (zip)

  X archive for @yourhandle (zip)
  Account created: 2019-03-01
  Tweets span:     2024-01-01 to 2025-03-15

  Tweets       3 (3 original, 0 replies, 0 retweets, 0 with media)
  Likes        1
  Following    2
  Followers    1
  Blocks       0
  Mutes        0
  DMs          0 messages in 0 conversations
  Lists        0
  Media files  0
  Engagement   12 likes, 3 retweets received
  Busiest year 2024 (2 tweets)

  Tweets per year
    2024  2
    2025  1

  Top hashtags
    #xactions  2
    #firstpost  1

  Top mentions
    @alice  1

  Not in this archive: blocks, mutes, dms, lists, media

  Export it with `xactions archive export twitter-2026-08-28.zip --out <dir>`.
```

(That run is against a three-post test archive, so the numbers are small. Yours
will not be.)

The **Not in this archive** line matters. X's export contents vary by account
age and by what you have used, so a missing section is normal rather than a
parse failure. `archive summary` tells you which sections it actually found
instead of quietly reporting zero.

Two flags worth knowing:

```bash
xactions archive summary twitter-2026-08-28.zip --top 25          # more hashtags and mentions
xactions archive summary twitter-2026-08-28.zip --sections tweets # skip the rest, much faster
```

`--sections` is the one to reach for on a large archive: reading only `tweets`
skips megabytes of DMs and likes you did not ask about. It also means the
account header reads `@unknown`, because the handle lives in the `account`
section you just skipped.

And as data, for anything that is going to script this:

```bash
xactions archive summary twitter-2026-08-28.zip --json | jq '.counts'
```

```json
{
  "tweets": 3,
  "replies": 0,
  "retweets": 0,
  "original": 3,
  "withMedia": 0,
  "likes": 1,
  "following": 2,
  "followers": 1,
  "blocks": 0,
  "mutes": 0,
  "dmConversations": 0,
  "dmMessages": 0,
  "lists": 0,
  "mediaFiles": 0
}
```

The other top-level keys are `username`, `accountCreatedAt`, `dateRange`,
`busiestYear`, `tweetsPerYear`, `engagement`, `topHashtags`, `topMentions`,
`sections`, `format`, `archivePath`, and `source`.

## 3. Turn it into files you can actually use

X's export is a folder of JavaScript files that assign to `window.YTD.*`. That
is fine for X's own viewer and useless for everything else. `archive export`
converts the lot:

```bash
xactions archive export twitter-2026-08-28.zip --out my-archive
```

```
✔ Read twitter-2026-08-28.zip (zip)
✔ Wrote 25 files to my-archive

  profile      1
  tweets       3
  likes        1
  following    2
  followers    1
  blocks       0
  mutes        0
  dms          0
  lists        0
  media        0

  Open my-archive/index.html in a browser to browse it.
  Compare against a live export with `xactions diff <dirA> my-archive`.
```

You get four shapes of the same data, because different jobs want different
ones:

| Format | Files | Good for |
|--------|-------|----------|
| JSON | `tweets.json`, `likes.json`, `following.json`, … | scripts, `jq`, importing anywhere |
| CSV | `tweets.csv`, `followers.csv`, `following.csv`, `likes.csv` | spreadsheets, and anyone who does not write code |
| Markdown | `tweets.md`, `profile.md`, … | reading, grepping, dropping into notes |
| HTML | `index.html` | browsing it like a website, offline |

`--formats` narrows that when you only want one:

```bash
xactions archive export twitter-2026-08-28.zip --out my-archive --formats json,md
```

`--sections` works here too, so `--sections tweets,likes` gets you a posts-only
export in a fraction of the time.

Now the useful part. This is ordinary JSON:

```bash
jq 'length' my-archive/tweets.json
jq -r 'sort_by(-(.likes // 0))[:10][] | "\(.likes)\t\(.text[0:80])"' my-archive/tweets.json
jq -r '[.[] | select(.text | test("hiring"; "i"))] | length' my-archive/tweets.json
```

## 4. Diff two exports

Request a second archive six months later and the two are directly comparable:

```bash
xactions diff my-archive-january my-archive-july
```

That is also how you check what a live scrape missed: export your account with
`xactions export YOUR_HANDLE`, then diff that directory against the archive
export. Anything present in the archive and absent from the scrape is content X
no longer serves publicly.

## 5. Take it somewhere else

The archive already holds everything needed to rebuild the account elsewhere,
so migration is a read of a local file rather than thousands of scraped
requests.

**Dry run first.** It is the default, and it writes nothing to any network:

```bash
xactions archive migrate twitter-2026-08-28.zip --to bluesky --out staged
```

```
✔ Migration preview complete

  Platform: bluesky
  Mode:     DRY RUN
  Tweets:   3/3 ready
  Follows:  2/2 matchable
  Staged:   staged

  Sample actions:
    create_post: Hello world #firstpost [dry-run]
    create_post: Shipping #xactions with @alice [dry-run]
    create_post: Still #xactions [dry-run]
    follow: unknown [dry-run]
    follow: unknown [dry-run]

  This was a dry run. Add --execute and your credentials to perform it.
```

`--out` writes the normalised archive into the staged directory: `tweets.json`,
`following.json`, `followers.json`, `likes.json`, `profile.json`, and a
`summary.json`, one file per section. Read them. Edit `tweets.json`. This is the
moment to drop the 2019 posts you would rather not carry over, and it is much
easier than deleting them on the far side. Each staged post carries `id`,
`text`, `createdAt`, `url`, `inReplyTo`, `retweeted`, `media`, and `metrics`.

Mastodon is the same command with a different target, and posts become toots:

```bash
xactions archive migrate twitter-2026-08-28.zip --to mastodon --out staged
```

```
    create_toot: Hello world #firstpost [dry-run]
```

**Then, and only then, execute:**

```bash
# Bluesky: use an app password, never your account password.
# Settings → Privacy and security → App passwords.
xactions archive migrate twitter-2026-08-28.zip \
  --to bluesky --execute \
  --handle you.bsky.social \
  --password xxxx-xxxx-xxxx-xxxx

# Mastodon: a token from Preferences → Development → New application,
# with write:statuses and write:follows.
xactions archive migrate twitter-2026-08-28.zip \
  --to mastodon --execute \
  --instance https://mastodon.social \
  --token YOUR_ACCESS_TOKEN
```

`--json` on any of the three sub-commands prints the summary as data, which is
what you want if this is running unattended.

## 6. Where the archive beats scraping

Worth being clear about, because it decides which tool to reach for:

| | Archive | Live scrape |
|---|---|---|
| Deleted posts | present | gone |
| DMs | present | needs a session, and only recent ones |
| Your own likes, in full | present | session-tier and slow |
| Follower and following lists | ids only, no handles | full profiles |
| Anyone else's account | no | yes |
| Freshness | as of the export date | now |
| Rate limits | none | yes |

The follower row is the one that surprises people. X's export stores your
followers as account ids, not handles, so the archive tells you how many and
which ids, and a live read is what turns those into names.

## What you learned

- The archive is the only copy of your account nobody can rate limit or revoke
- `archive summary` tells you which sections X actually included, not just counts
- `archive export` turns `window.YTD.*` JavaScript into JSON, CSV, Markdown and a browsable page
- `--sections` and `--formats` are how a large archive stays quick
- Migration is a dry run by default, and staging the actions is your chance to edit them

## Next

- [06: Everything is JSON](06-everything-is-json.md) to script the exported files
- [05: Read any account like an analyst](05-competitive-intelligence.md) for the live-data equivalent
- [Account portability](../docs/portability.md) for the migration internals
- [CLI reference](../docs/cli-reference.md) for every flag
