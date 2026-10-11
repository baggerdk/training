# power-krop – server

Backend til power-krop: Postgres med RLS, et Fastify-API (auth, brugere, sync og administration) og Cloudflare
Tunnel. Det hele kører som en Docker Compose-stack i en dedikeret LXC på Proxmox. Der åbnes ingen porte i routeren.

| Service | Hvad |
|---|---|
| `db` | Postgres 16 (volume `pgdata`) |
| `api` | Fastify på :3000 – også `/admin` (administration) og `/app` (download af APK) |
| `backup` | Natlig `pg_dump` til `./backups`, 14 dages rotation |
| `cloudflared` | Cloudflare Tunnel → `api:3000` (profilen `tunnel`) |

## Opsætning af en ny server

1. LXC: Debian 12, unprivileged, `nesting=1,keyctl=1`, ca. 2 vCPU / 2 GB RAM / 20 GB disk, statisk IP.
2. Installér Docker fra Dockers eget apt-repo (ikke Debians `docker.io`).
3. `git clone https://github.com/<bruger>/<repo>.git /opt/power-krop`
4. `cd /opt/power-krop/server && cp .env.example .env`, og udfyld hemmelighederne (`openssl rand -base64 48`).
   Sæt `COMPOSE_PROFILES=tunnel` og `TUNNEL_TOKEN` for at starte tunnelen. Filen må aldrig i git.
5. `docker compose up -d --build` – tjenesten `migrate` kører migrationerne som `powerkrop_owner` og stopper igen; API'et starter først bagefter og har ikke owner-passwordet.
6. Første admin: `docker compose run --rm migrate node src/scripts/create-admin.ts <email> "<navn>"`.
   Linket, der skrives ud, åbnes for at vælge password.

## Opdatering

```sh
cd /opt/power-krop && git pull
cd server && docker compose up -d --build
```

Brug `docker compose up -d` efter en genstart, hvis du har kørt `docker compose stop` – containerne står på
`restart: unless-stopped` og starter ellers ikke af sig selv.

### Ny version af appen

Læg den signerede APK og en `version.json` i `server/apk/` (ikke i git):

```json
{ "versionCode": 2, "versionName": "1.1", "minSupportedVersionCode": 1 }
```

Den hentes derefter på `https://<api-host>/app`.

## Backup

`backup`-servicen tager hver nat kl. 03:00 (`BACKUP_TIME`) et `pg_dump` i custom-format til `server/backups/`.
Dumps over 14 dage gamle (`BACKUP_KEEP_DAYS`) slettes, så data fra "Slet min konto" også forsvinder fra
backupperne inden for 14 dage. Hvert dump tjekkes med `pg_restore -l`, før det gemmes.

- Dumps ligger på LXC'ens egen disk. **Off-site/off-node** sker ved, at Proxmox' `vzdump` af hele LXC'en kører
  efter `pg_dump` og gemmer på et netværksdrev.
- Servicen er `unhealthy`, hvis det seneste gode dump er mere end 26 timer gammelt (`docker compose ps`).
- Tag et dump med det samme: `docker compose exec backup sh /backup.sh once`
- Se backupperne: `ls -lh server/backups/`

## Gendannelse

**Test (rører intet, kør den jævnligt):**

```sh
docker compose exec backup sh /restore.sh test                       # nyeste dump
docker compose exec backup sh /restore.sh test /backups/<fil>.dump   # et bestemt dump
```

Dumpet gendannes i en separat database (`powerkrop_restoretest`), antallet af rækker i alle tabeller sammenlignes
med den rigtige database, og testdatabasen slettes igen.

**Rigtig gendannelse (overskriver data):**

```sh
docker compose stop api cloudflared
docker compose exec backup sh /restore.sh live /backups/<fil>.dump
docker compose up -d
```

Gendannelsen kører i én transaktion: fejler den, er databasen uændret. Rollerne (`powerkrop_owner`,
`powerkrop_app`, `powerkrop_definer`) skal findes – det gør de på samme server. På en ny server oprettes de af
`db/init/01-roles.sh`, når volumen oprettes første gang (med passwords fra `.env`).

**Hele LXC'en er væk:** Gendan LXC'en fra den seneste `vzdump` i Proxmox (Datacenter → Backup / storage → Restore).
Det giver både stack, `.env` og de lokale dumps tilbage.

## Tests

```sh
docker compose -f compose.test.yml up -d --wait   # midlertidig test-database på 127.0.0.1:15433
cd api && npm test
```

Lokal udvikling med porte på 127.0.0.1: `docker compose -f compose.yml -f compose.dev.yml up -d --build`.
