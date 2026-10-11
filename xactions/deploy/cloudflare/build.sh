#!/usr/bin/env bash
# Assembles the Cloudflare Pages output directory from public/, dashboard/,
# and the marketing landing page in site/. Run from the repo root:
#   bash deploy/cloudflare/build.sh
# Then deploy the result:
#   npx wrangler pages deploy pages-out --project-name xactions
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf pages-out
mkdir -p pages-out
cp -r public/. pages-out/
cp -r dashboard/. pages-out/
# dashboard/index.html is the app dashboard; move it aside so the marketing
# landing page can take the root, matching the old vercel.json routing
mv pages-out/index.html pages-out/dashboard.html
cp site/index.html pages-out/index.html
cp llms.txt llms-full.txt pages-out/
cp deploy/cloudflare/_redirects pages-out/_redirects

# There is deliberately no mcp.html here. /mcp is the MCP endpoint, served by
# functions/mcp.js, and Pages serves a matching static asset before it invokes a
# function, so a file at that path would shadow the endpoint and answer POST
# /mcp with a bare 405 from the asset server. The page is named mcp-docs.html at
# source (dashboard/mcp-docs.html) and the function serves it back to any client
# that asks for HTML, so the URL still renders in a browser.
test ! -f pages-out/mcp.html || { echo "error: dashboard/mcp.html would shadow the /mcp function; name it mcp-docs.html" >&2; exit 1; }

# Which paths reach functions/. Without this file Pages infers the list, and a
# static asset that shares a path with a function wins: dashboard/mcp.html was
# shadowing functions/mcp.js, so POST /mcp answered 405 from the asset server
# instead of speaking MCP. Listing the dynamic paths explicitly settles it, and
# keeps every other request on the static path with no Worker invocation.
cat > pages-out/_routes.json <<'ROUTES'
{
  "version": 1,
  "include": ["/api/*", "/mcp", "/openapi.json", "/.well-known/*"],
  "exclude": []
}
ROUTES
echo "Built pages-out/ ($(find pages-out -type f | wc -l) files)"
