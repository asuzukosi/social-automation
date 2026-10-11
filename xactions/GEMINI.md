# XActions: instructions for Gemini

**Read [AGENTS.md](AGENTS.md).** It is the single source of truth for how to work in this
repository, and it is kept current. This file adds only what is specific to Gemini; it
deliberately does not restate AGENTS.md, because the last time four files described the
repository they drifted apart and an agent worked a whole session from the stale one.

AGENTS.md answers, in this order: which lane to use (shell out to the `xactions` CLI, or
load the MCP server), the CLI lane and its output contract, the MCP lane, a table from
common request to the exact file that answers it, the skills, the directory map and the
three runtime contexts, and the mistakes that have actually cost people time here.

## Gemini specifics

The CLI lane is usually the right one here: one shell call, no tool list to load.

```bash
npx xactions profile nasa --compact     # no account, no browser
npx xactions tweets nasa --limit 50 --json
```

`--compact` prints one record per line as tab-separated `key=value` pairs; `--fields`
narrows that to the columns you name; `--json` prints the full object. `--compact` wins
if both are passed.

The skills are plain Markdown and readable directly from [`skills/`](skills/). The
installer writes them into a specific host's directory, and its targets today are
`claude`, `project`, `cursor`, `codex` and `windsurf`:

```bash
xactions skills list                            # every skill and what it covers
xactions skills show follower-monitoring        # read one without installing it
xactions skills install --all --target project  # ./.claude/skills/ in this repo
```

Everything else is in [AGENTS.md](AGENTS.md).
