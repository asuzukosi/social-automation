# Security Policy

## Reporting a vulnerability

Do **not** open a public issue. Open a [private security advisory](https://github.com/nirholas/XActions/security/advisories/new)
on GitHub, or contact [@nichxbt](https://x.com/nichxbt) directly.

Include what you did, what happened, and what you expected. Give a reasonable window
for a fix before disclosing. Security reports are answered ahead of everything else.

## Supported versions

| Version | Supported |
|---------|-----------|
| 3.5.x   | Yes |
| < 3.5   | No. Upgrade; releases are frequent and free. |

## What this project does with your credentials

XActions acts as you, on your machine, with your own X session. That has consequences
worth stating plainly:

- **Your session cookies are a live login.** Anyone who can read
  `~/.xactions/cookies.json` can post as you. XActions writes credential files
  owner-only (`0600`, inside a `0700` directory) and `.gitignore` refuses to track
  them. Treat that file like an SSH key: do not paste it into an issue, do not commit
  it, do not sync it to a shared drive.
- **Nothing is sent anywhere.** Reads and writes go to x.com directly. There is no
  telemetry, no analytics beacon, and no server of ours in the path. The one exception
  is a feature you configure yourself, such as an LLM provider for generated replies,
  which sends only what you asked it to send.
- **The hosted API is separate and optional.** Nothing you run locally requires it.
- **Signing keys have no defaults.** The API refuses to boot in production without
  `JWT_SECRET`. It used to fall back to a constant published in this repository, which
  meant anyone could forge a token; that fallback is gone.

If you run the API server yourself, generate a real secret, and keep the plugin
installer and webhook endpoints off the public internet unless you have reviewed them:

```bash
openssl rand -hex 32
```

## Where this project stands with X

XActions reads x.com through the same internal endpoints the website uses,
authenticated as you. In August 2026, X sent cease-and-desist letters over third-party
front ends built on that surface. Our position, so nobody has to guess:

- **XActions runs on your machine, with your session, at your direction.** It is a
  client, not a service. We do not operate a scraping service, we do not resell X data,
  and we never hold anyone else's session.
- **We will not build a hosted service that scrapes X on other people's behalf.** It is
  on the "deliberately not building" list in [ROADMAP.md](ROADMAP.md).
- **If X wants something changed, we want to hear from them.** Contact
  [@nichxbt](https://x.com/nichxbt) and we will engage in good faith.

### The risk you are taking on

X's rules prohibit automated following, liking, retweeting, and unsolicited automated
DMs. Enforcement escalates from a temporary write block to permanent suspension. That
risk is real, and it is yours:

- Use a dedicated account for anything experimental.
- Keep the pacing defaults. Every bulk action jitters its delays, rests periodically,
  and backs off when X pushes back. Removing that to go faster is how accounts get
  restricted, which is why the fastest preset is labelled as risky where it is offered.
- Prefer reads. Reading public data is a materially different risk from writing.
- Automated DM campaigns are not supported here and will not be. Reading and exporting
  your own conversations is a different thing, and that is supported.

XActions is provided for research and personal use, with no warranty. You are
responsible for what you run, and for the terms of any service you point it at.

## Anti-bot reality

X uses Cloudflare Turnstile at login, rate-limits by account and by IP, blocks
datacenter address ranges, and binds tokens to a client fingerprint.
`puppeteer-extra-plugin-stealth` helps and is not sufficient on its own in 2026. If you
are being challenged constantly, the answer is usually a residential IP and slower
pacing, not more retries.
