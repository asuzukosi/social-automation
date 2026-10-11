# api/

The Express REST API behind the hosted dashboard and remote AI access: JWT auth, X session management, scraping and posting operations, billing (Stripe), optional x402 micropayments, Socket.IO realtime, and a Bull job queue.

- `server.js` is the entry point; `serverless.js` is the Cloudflare/Vercel adapter.
- `routes/` holds one module per surface, `services/` the business logic, `middleware/` auth, rate limiting, x402.
- Configuration comes from `.env` (copy `.env.example`). `DATABASE_URL` (PostgreSQL via Prisma) and `JWT_SECRET` are required in production.

Run locally:

    npm run dev        # nodemon, http://localhost:3001
    npm start          # production mode

Reference: [docs/api-reference.md](../docs/api-reference.md), [docs/deployment.md](../docs/deployment.md).
