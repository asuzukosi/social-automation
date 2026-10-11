# bin/

Standalone executables that are not part of the `xactions` npm binaries.

- `unfollowx`: a Node script (CommonJS, Business Source License) that runs the unfollow tooling as a one-word command.

The package binaries (`xactions`, `xactions-mcp`, `xactions-agent`) are declared in `package.json` and live under `src/`.

    chmod +x bin/unfollowx && ./bin/unfollowx --help
