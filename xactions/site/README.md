# site/

Source for the marketing site and the generated documentation site.

- `index.html` and `assets/`: the landing page.
- `video/`: Remotion project for the promo and tweet videos (`npm run video:preview`, `npm run video:render`).

Build the full static site (docs pages, script pages, sitemap) into `pages-out/`:

    npm run site:build
    npm run site:deploy     # Cloudflare Pages
