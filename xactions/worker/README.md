# worker/

Cloudflare Worker entry (`index.js`, wired by `wrangler.toml`). It serves the static site from Workers assets built by `scripts/build-cloudflare.mjs`, answers health, pricing, and x402 discovery at the edge, issues 402 challenges for paid AI routes, and proxies every other `/api/*` request to `API_ORIGIN`.

    npm run build:cloudflare
    npx wrangler dev          # local
    npx wrangler deploy
