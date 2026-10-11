# skills/

Agent Skills: one directory per skill, each with a `SKILL.md` that teaches an AI assistant (Claude, Cursor, Copilot) how to use a part of XActions. Registered in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.

- `TEMPLATE.md` is the starting point for a new skill.
- Keep each `SKILL.md` self-contained: what the skill does, when to use it, the exact tools or commands it invokes.

    ls skills/*/SKILL.md | wc -l    # current count

Reference: [docs/skills.md](../docs/skills.md).
