#!/usr/bin/env bash
#
# Applies the migrations to a throwaway database and runs the smoke test.
#
# Validates against a plain PostgreSQL instance using the shim in
# supabase/tests/local_shim.sql — no Supabase project, no network. It catches the
# class of bug that unit tests cannot see at all: PL/pgSQL name shadowing,
# missing grants, a policy that does not do what its name says.
#
# Usage:
#   scripts/db-test.sh                     # uses PGHOST/PGPORT/PGUSER or local defaults
#   PGHOST=/tmp PGPORT=55432 scripts/db-test.sh
set -euo pipefail

DB="${PARTY_TEST_DB:-party_migration_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q)

echo "==> recreating $DB"
dropdb --if-exists "$DB"
createdb "$DB"

echo "==> supabase shim"
"${PSQL[@]}" -d "$DB" -f supabase/tests/local_shim.sql > /dev/null

for file in supabase/migrations/*.sql; do
  echo "==> $(basename "$file")"
  "${PSQL[@]}" -d "$DB" -f "$file" > /dev/null
done

echo "==> smoke test"
# Assertions announce themselves as NOTICE lines; a failure raises and, with
# ON_ERROR_STOP, takes the script down with a non-zero status.
# Strip the psql NOTICE prefix first, then print only the assertion lines —
# two separate -e expressions, so a substituted line is not printed twice.
psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/smoke.sql 2>&1 \
  | sed -n -e 's/.*NOTICE:  //' -e '/^\(ok \|FAIL\|---\)/p' -e '/ERROR/p'

echo "==> dropping $DB"
dropdb "$DB"
echo "OK"
