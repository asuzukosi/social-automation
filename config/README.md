# config/

Configuration for the autonomous thought-leader agent (`npm run agent`).

- `agent-config.example.json`: copy to `agent-config.json` and fill in your handle, niche, and posting cadence.
- `niches/`: topic packs (keywords, accounts to watch, hashtags) the agent can be pointed at.
- `personas/`: voice and tone definitions the content generator uses.

    cp config/agent-config.example.json config/agent-config.json
    npm run agent:setup

See [docs/agents.md](../docs/agents.md) for the full agent guide.
