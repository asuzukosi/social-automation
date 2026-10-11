# Deploying xactions.app to Cloudflare Pages

The site (landing page + dashboard + docs/blog/tutorials) deploys to Cloudflare
Pages for free (unlimited requests/bandwidth on the Free plan, no card
required). This replaces the old Vercel deployment, which was disabled.

## One-time setup

1. Create a Cloudflare API token at
   https://dash.cloudflare.com/profile/api-tokens with
   `Account -> Cloudflare Pages -> Edit` permission.
2. Find your Account ID on any domain's Overview page in the Cloudflare
   dashboard (right sidebar), or via `GET /accounts` with the token.
3. Create the Pages project once:
   ```
   export CLOUDFLARE_API_TOKEN=...
   export CLOUDFLARE_ACCOUNT_ID=...
   npx wrangler pages project create xactions --production-branch main
   ```

## Deploy

```
bash deploy/cloudflare/build.sh
npx wrangler pages deploy pages-out --project-name xactions
```

`build.sh` assembles `pages-out/` from three sources:
- `public/` (og images, logos, demo assets, base `robots.txt`/`sitemap.xml`)
- `dashboard/` (538 pages: docs, tutorials, blog, scripts directory, app).
  Its `index.html` (the app dashboard) is moved to `dashboard.html` so the
  marketing landing page can own the root URL.
- `site/index.html` (the marketing landing page) becomes the new root
  `index.html`.

`deploy/cloudflare/_redirects` is copied in as the final step. Keep it in
sync with any new routes; see the note below on what does and doesn't need
a rule.

## Cloudflare Pages routing gotchas (read before adding redirect rules)

Cloudflare Pages has **built-in clean URLs**: any `foo.html` file is already
served at `/foo`, and a direct request to `/foo.html` gets a 308 redirect to
`/foo`. Because of this:

- Most `/name -> /name.html` rules in `_redirects` are unnecessary and will
  be handled automatically. Don't add one unless the target name differs
  from the request path (like `/dashboard -> /dashboard.html` here, which
  IS needed since the names differ).
- A `200`-status rewrite rule whose target is an `.html` file gets passed
  back through the clean-URL canonicalizer. For an exact-match rule this is
  harmless (the canonical path resolves back to the same request path). For
  a **wildcard** rule (`/thread/* -> /thread.html`), the canonicalizer
  redirects the client to the bare `/thread` and **drops the wildcard
  segment**. There is no known `_redirects`-only fix for this (the `!`
  force flag makes it 404 instead). If you need real wildcard/SPA-style
  routing with the parameter preserved, it has to be done client-side
  (read `location.pathname` in JS after landing on `/thread`) or via a
  Cloudflare Pages Function, not a static `_redirects` rewrite.
- A bare directory path with no colliding `.html` file (e.g. `/scripts`,
  which only has `scripts/index.html`) gets a normal single-hop 308 to the
  trailing-slash form (`/scripts/`), which then serves the index. This is
  standard web server behavior, not a bug — no rule needed.

## The `/api/*` surface

`_redirects` cannot proxy to another origin: Pages accepts a 200-rewrite only
when it points at a relative path, and silently drops the rule otherwise
(wrangler prints "Proxy (200) redirects can only point to relative paths" at
build time). The `/api/*` rule that used to live here therefore never worked,
which is why `POST /api/video/extract` answered a bare 405 from the static
asset handler.

`/api/*` is now served by Pages Functions in [`functions/`](../../functions),
which deploy with the site:

- `/api/health` and the three `/api/video/*` routes run entirely at the edge,
  with no backend at all.
- Every other `/api/*` route needs the Node backend (Postgres, Redis,
  Puppeteer). Set `XACTIONS_API_ORIGIN` on the Pages project to forward them to
  a self-hosted deployment; without it they answer a JSON 503 that says so.

## Current limitations

- App pages that call non-video API routes (login, monitor,
  analytics-dashboard) need a self-hosted backend and `XACTIONS_API_ORIGIN`.
  All content pages (docs, blog, tutorials, pricing) and the video downloader
  work fully without one.
- Deploys come from `.github/workflows/deploy-cloudflare.yml`, which requires
  the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Alternative: Google Cloud Run

`deploy/gcp/` deploys the same static bundle to Cloud Run via nginx, for
environments where Cloudflare isn't available. It costs a small amount
(sub-$1-2/month at low traffic, scale-to-zero) versus Cloudflare Pages'
$0. Prefer Cloudflare Pages when possible.
