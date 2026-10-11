# playground/

A hosted try-it-out sandbox for the MCP tools: a small Node server (`server.mjs`) plus a static front end in `public/` that lets visitors call read-only tools without installing anything.

    cd playground && npm install && node server.mjs   # http://localhost:8080 (PORT overrides)

`Dockerfile` and `cloudbuild.yaml` deploy it to Cloud Run.
