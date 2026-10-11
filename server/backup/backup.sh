#!/bin/sh
# Nightly pg_dump of the power-krop database (the `backup` service in server/compose.yml).
#   - custom format (-Fc): compressed, restorable with pg_restore, also table by table
#   - runs as the superuser: FORCE ROW LEVEL SECURITY would hide every row from the table owner
#   - keeps BACKUP_KEEP_DAYS days (14), so data from "Slet min konto" is gone from backups after that
#   - writes /backups/last-ok after each good dump; the healthcheck fails if it is more than 26 hours old
# Run one dump right away:  docker compose exec backup sh /backup.sh once
set -eu

DIR=/backups
KEEP="${BACKUP_KEEP_DAYS:-14}"
AT="${BACKUP_TIME:-03:00}"     # local time (TZ)

dump() {
  stamp=$(date +%Y-%m-%d_%H%M)
  tmp="$DIR/.powerkrop_$stamp.dump.part"
  out="$DIR/powerkrop_$stamp.dump"
  # Explicit "|| return 1": set -e does not apply inside a function called as "dump || …" (the loop below),
  # so without it a failed dump would still be renamed, rotate old ones away and be marked as ok
  pg_dump -h db -U postgres -d powerkrop -Fc -Z 6 -f "$tmp" || { rm -f "$tmp"; return 1; }
  # A dump that pg_restore can't read is not a backup
  pg_restore -l "$tmp" > /dev/null || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$out" || return 1
  # -mtime +N matches files older than N+1 whole days, so +(KEEP-1) keeps KEEP days of dumps
  find "$DIR" -name 'powerkrop_*.dump' -mtime +"$((KEEP - 1))" -delete
  find "$DIR" -name '.powerkrop_*.dump.part' -mtime +0 -delete
  date -Iseconds > "$DIR/last-ok"
  echo "$(date -Iseconds) backup ok: $(basename "$out") ($(du -h "$out" | cut -f1)), beholder $KEEP dage"
}

if [ "${1:-}" = "once" ]; then dump || exit 1; exit 0; fi

echo "$(date -Iseconds) backup-service startet: dagligt kl. $AT, $KEEP dages rotation i $DIR"
[ -f "$DIR/last-ok" ] || dump || echo "$(date -Iseconds) BACKUP FEJLEDE" >&2   # first start: make one right away
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) $AT" +%s 2>/dev/null || date -D '%Y-%m-%d %H:%M' -d "$(date +%Y-%m-%d) $AT" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  dump || echo "$(date -Iseconds) BACKUP FEJLEDE" >&2
done
