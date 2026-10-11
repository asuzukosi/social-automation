# packages/

Publishable sub-packages that ship separately from the main `xactions` package.

- `xactions-mcp/`: a thin distribution of the MCP server for registries that want a dedicated package (`npx xactions-mcp`).
- `xactions-edge/`: a zero-dependency client for the hosted edge server at `xactions.app/mcp`. Public X reads from Node, browsers, Workers, Deno and Bun, with no API key, plus `npx xactions-edge` for one-line reads from a terminal.

Each package has its own `package.json`; run its scripts from inside the directory:

    cd packages/xactions-mcp && npm install && npm start
