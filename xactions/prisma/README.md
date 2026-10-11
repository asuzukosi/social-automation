# prisma/

Database schema and migrations for the API (PostgreSQL through Prisma).

- `schema.prisma`: models for users, sessions, operations, licenses, billing.
- `migrations/`: generated migration history. Never edit applied migrations.
- `seed.js`: seeds a local database with a demo user.

    npm run db:migrate   # create/apply a migration in development
    npm run db:push      # push schema without a migration
    npm run db:seed
    npm run db:studio    # browse data

Requires `DATABASE_URL` in `.env`.
