# Tutorials

Guided walkthroughs. Each one starts from nothing and ends with something
working, and every command in them has been run.

If you would rather read code than prose, the [`examples/`](../examples/)
directory has the same material as short runnable programs.

---

## Start here

| # | Tutorial | Time | You end up with |
|---|----------|------|-----------------|
| 01 | [Your first scrape](01-your-first-scrape.md) | 5 min | Real profile and timeline data, from the terminal and from Node |
| 02 | [Claude that can use X](02-mcp-with-claude.md) | 10 min | Claude Desktop or Cursor driving 152 XActions MCP tools, behind an approval gate |
| 03 | [Clean up your following list](03-clean-up-your-following.md) | 20 min | A safe, reviewed unfollow of accounts that do not follow back |
| 04 | [Build a brand monitor](04-build-a-brand-monitor.md) | 30 min | A running service that watches X and alerts you on negative mentions |
| 05 | [Read any account like an analyst](05-competitive-intelligence.md) | 15 min | A defensible read on how any account performs, and how two differ |
| 06 | [Everything is JSON](06-everything-is-json.md) | 20 min | XActions inside your own pipelines: jq, cron, exit codes, tab completion |
| 07 | [Read your own X archive](07-your-x-archive.md) | 15 min | Your X data export as JSON, CSV, Markdown and HTML, and staged for Bluesky or Mastodon |

Work through them in order the first time. Each assumes the setup from the one
before it. Tutorials 01, 05, 06 and 07 need no X account at all: 07 does not
even go online.

Never used the CLI before? `xactions quickstart` is the thirty-second version of
tutorial 01, and adapts to what you already have set up. `xactions doctor` is
the one to run when something is not behaving: it tests the guest tier for real
and names the fix for anything it finds.

---

## Prompt library for AI assistants

[`claude-prompts/`](claude-prompts/) is a different thing: 23 ready-to-paste
prompts that hand an AI assistant a complete task brief. Paste one into Claude,
Cursor, or ChatGPT and it has the context to do the job.

| Area | Prompts |
|------|---------|
| Setup and CLI | [01](claude-prompts/01-mcp-setup-and-first-commands.md), [15](claude-prompts/15-cli-mastery-guide.md), [16](claude-prompts/16-browser-automation-framework.md) |
| Follower management | [02](claude-prompts/02-unfollow-non-followers-cleanup.md), [03](claude-prompts/03-growth-automation-suite.md), [07](claude-prompts/07-auto-liker-auto-commenter.md) |
| Content | [05](claude-prompts/05-content-posting-threads-scheduling.md), [12](claude-prompts/12-bookmark-management-export.md), [13](claude-prompts/13-content-cleanup-unlike-clear.md), [17](claude-prompts/17-video-download-thread-media.md) |
| Research and analytics | [04](claude-prompts/04-scraping-research-analysis.md), [06](claude-prompts/06-analytics-competitor-intelligence.md), [14](claude-prompts/14-brand-monitoring-business-tools.md), [18](claude-prompts/18-grok-ai-sentiment-analysis.md) |
| Automation | [09](claude-prompts/09-dm-management-automation.md), [19](claude-prompts/19-customer-service-bot.md), [21](claude-prompts/21-workflows-account-portability.md), [23](claude-prompts/23-autonomous-space-agent.md) |
| Account and safety | [08](claude-prompts/08-blocking-muting-spam-protection.md), [11](claude-prompts/11-profile-backup-settings.md), [20](claude-prompts/20-session-logging-safety.md) |

Full index: [claude-prompts/README.md](claude-prompts/README.md).

---

## Where else to look

- [Examples](../examples/) — nine runnable programs, shorter than tutorials
- [Documentation](../docs/) — reference material
- [Agent skills](../docs/skills.md) — 49 procedures, installed with `xactions skills install`
- [Browser scripts](../docs/browser-scripts.md) — 95 of them, no install at all
- [Troubleshooting](../docs/troubleshooting.md) — when something does not work
