#!/bin/sh
# Restores a pg_dump made by backup.sh. Run inside the backup container:
#
#   Test (safe, touches nothing):   docker compose exec backup sh /restore.sh test  [/backups/<fil>.dump]
#     restores into a separate database `powerkrop_restoretest`, compares row counts with the live
#     database, and drops the test database again.
#
#   Real restore (overwrites data):  docker compose stop api cloudflared
#                                    docker compose exec backup sh /restore.sh live /backups/<fil>.dump
#                                    docker compose up -d
#     The roles (powerkrop_owner/app/definer) must exist – they do on the same server; on a new server
#     they are created by db/init/01-roles.sh when the volume is created (same passwords from .env).
set -eu

MODE="${1:-}"
FILE="${2:-$(ls -1t /backups/powerkrop_*.dump 2>/dev/null | head -1)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Ingen backup-fil fundet ($FILE)" >&2; exit 1; }
PSQL="psql -h db -U postgres -v ON_ERROR_STOP=1 -tA"
TABLES="users programs program_progress workout_sessions set_logs training_maxes user_exercise_videos max_tests user_settings custom_exercises athlete_profiles program_templates refresh_tokens invites schema_migrations"

counts() {   # $1 = database
  for t in $TABLES; do printf '%s=%s ' "$t" "$($PSQL -d "$1" -c "select count(*) from $t" 2>/dev/null || echo '-')"; done
}

case "$MODE" in
  test)
    echo "Tester gendannelse af $(basename "$FILE") …"
    $PSQL -d postgres -c "drop database if exists powerkrop_restoretest" > /dev/null
    $PSQL -d postgres -c "create database powerkrop_restoretest owner powerkrop_owner" > /dev/null
    pg_restore -h db -U postgres -d powerkrop_restoretest --exit-on-error "$FILE"
    live=$(counts powerkrop); restored=$(counts powerkrop_restoretest)
    $PSQL -d postgres -c "drop database powerkrop_restoretest" > /dev/null
    echo "live:      $live"
    echo "gendannet: $restored"
    if [ "$live" = "$restored" ]; then echo "OK: gendannelsen giver samme antal rækker i alle tabeller"; else echo "FORSKEL (normalt kun hvis der er skrevet data siden backuppen)"; fi
    ;;
  live)
    echo "Gendanner $(basename "$FILE") over den rigtige database om 10 sekunder – Ctrl+C for at afbryde"
    sleep 10
    pg_restore -h db -U postgres -d powerkrop --clean --if-exists --single-transaction --exit-on-error "$FILE"
    echo "Gendannet: $(counts powerkrop)"
    ;;
  *)
    echo "Brug: /restore.sh test [fil]   eller   /restore.sh live <fil>" >&2; exit 1 ;;
esac
