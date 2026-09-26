#!/bin/sh
# Full startup sequence for a fresh or existing database:
#   1. Sync the database schema (creates any missing tables)
#   2. Seed default data (categories, etc. — safe to re-run, skips
#      anything already present)
#   3. Start the actual server
#
# Kept as its own script file, rather than a multi-command string typed
# into Render's dashboard, since that field didn't reliably parse "&&"
# chains and quoting the way a real shell would.
set -e

npx prisma db push --skip-generate
npm run seed
npm start
