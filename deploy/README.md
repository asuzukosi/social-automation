# Deploying XActions

XActions ships configs for seven platforms. That is generous, and it is also how
`railway.json` and `railway.toml` ended up saying the same thing twice while
`nixpacks.toml` describes a build nothing currently runs. This page is the picker:
which file is live on which platform, and which are inert until you change something.

Full runbook: [docs/deployment.md](../docs/deployment.md).

## What you are deploying

Two different things, and most confusion here comes from mixing them up:

| | The API | The site |
|---|---|---|
| What it is | Express server, `api/server.js`: REST, jobs, Socket.io | Static pages under `site/` and `dashboard/` |
| Needs | PostgreSQL, Redis, a `JWT_SECRET` | nothing at runtime |
| Deploy with | Railway, Fly, Render, Docker, Cloud Run | Cloudflare Pages or Workers |

Neither is required to use XActions. The CLI, the library and the MCP server all run
locally with no server at all.

## The API

| Platform | Live config | Command |
|---|---|---|
| Docker (recommended) | `Dockerfile`, `docker-compose.yml` | `npm run docker:up` |
| Railway | `railway.json` | `npm run deploy:railway` |
| Fly.io | `fly.toml` | `npm run deploy:fly` |
| Render | `render.yaml` | connect the repo in Render |
| Google Cloud Run | `deploy/gcp/cloudbuild-api.yaml` | `deploy/gcp/provision-api.sh` |
| Coolify | `docker-compose.coolify.yml` | point Coolify at the repo |

### Railway, and which of its four files wins

Railway reads **`railway.json` first**. It is the live one.

- **`railway.toml`** expresses the same settings in TOML. Railway ignores it while
  `railway.json` exists, so editing it alone changes nothing. It is kept because a
  fork may prefer TOML; if you switch, delete the JSON so there is one answer.
- **`nixpacks.toml`** applies only when the builder is Nixpacks. Both Railway configs
  set the Dockerfile builder, so today it is inert and the `Dockerfile` decides how
  the image is built. It matters if you set the builder back to `NIXPACKS`, which is
  why it still describes the Chromium setup Puppeteer needs.
- **`Procfile`** declares the `web` and `worker` processes. Railway and Render read
  it; Docker does not.

Change a deploy setting in `railway.json` and mirror it into `railway.toml` in the
same commit, or delete whichever you are not using.

## The site

| Target | Config | Command |
|---|---|---|
| Cloudflare Workers | `wrangler.toml`, `deploy/cloudflare/build.sh` | `npm run deploy:cloudflare` |
| Cloudflare Pages | `deploy/cloudflare/_redirects` | `npm run site:deploy` |
| Vercel | `vercel.json` | `vercel deploy` |

`scripts/build-cloudflare.mjs` replays the `vercel.json` route table into a flat
`dist-cloudflare/`, so routes stay defined in one place.

## Before any deploy

```bash
npm test
npm run docs:check
npm run check:licenses
```

Set `JWT_SECRET` on the service. The API refuses to boot in production without one,
deliberately: it used to fall back to a constant published in this repository, which
meant anyone could mint a token for any user.

```bash
openssl rand -hex 32
```
