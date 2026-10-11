#!/bin/sh

# Run database migrations only if DATABASE_URL is available
if [ -n "$DATABASE_URL" ]; then
  echo "🔄 Running database migrations..."
  # Fresh DB: migrate deploy runs 0_init SQL and creates all tables.
  # Existing DB (created with db push, no migration history): deploy fails on
  # "relation already exists", so we mark the baseline as applied and redeploy.
  npx prisma migrate deploy || {
    echo "⚠️  Tables exist without migration history - marking baseline as applied..."
    npx prisma migrate resolve --applied "0_init" && npx prisma migrate deploy
  } || echo "⚠️  Migration warning (non-fatal), continuing..."
else
  echo "⚠️ DATABASE_URL not set, skipping migrations"
fi

exec node api/server.js
