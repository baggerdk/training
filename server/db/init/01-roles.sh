#!/bin/sh
# Runs once, when the Postgres volume is created (docker-entrypoint-initdb.d), as the superuser.
# Creates the three roles the app uses. Schema and RLS are created by the migrations (server/migrations).
#   powerkrop_owner   – runs migrations and owns the tables (FORCE RLS applies to it as well)
#   powerkrop_app     – the API's role: no superuser, no BYPASSRLS
#   powerkrop_definer – NOLOGIN + BYPASSRLS, owns the SECURITY DEFINER helper functions only
set -eu
: "${OWNER_PASSWORD:?OWNER_PASSWORD mangler}"
: "${APP_PASSWORD:?APP_PASSWORD mangler}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" -v owner_pw="$OWNER_PASSWORD" -v app_pw="$APP_PASSWORD" <<'EOSQL'
create role powerkrop_owner login password :'owner_pw';
create role powerkrop_app login password :'app_pw';
create role powerkrop_definer nologin bypassrls;
grant powerkrop_definer to powerkrop_owner;

alter database :"db" owner to powerkrop_owner;
revoke all on database :"db" from public;
grant connect on database :"db" to powerkrop_owner, powerkrop_app;

-- Short transactions keep /sync/pull's 30-second overlap window safe (see migrations/001_init.sql)
alter role powerkrop_app set statement_timeout = '10s';
alter role powerkrop_app set idle_in_transaction_session_timeout = '10s';
EOSQL
