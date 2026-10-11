# tests/

Vitest suite (`npm test`). Files are grouped by surface: `mcp/`, `cli/`, `client/`, `http-scraper/`, `a2a/`, `scheduler/`, `x402*`.

    npm test                     # full run
    npm run test:watch
    npx vitest run tests/mcp     # one area

Tests run without a browser or network; fixtures live next to the tests they feed (`http-scraper/fixtures/`). Config: `vitest.config.js` (fork pool capped at 4 workers).
