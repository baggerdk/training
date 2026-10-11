# power-krop – status

## Opnået

- **Android-app (Capacitor)** med signeret release-APK (version 1.5). Pausealarm, vibration og "hold skærmen tændt" bruger telefonens egne funktioner.
- **Login** med e-mail og password og aktivering via invitationslink. App Links åbner invitationen direkte i appen, og en gemt session virker offline.
- **Lokal lagring i IndexedDB** med én database pr. bruger. Gamle data fra før login flyttes til kontoen.
- **Synkronisering** med serveren:
  - Ændringer sendes, når der er net, og overlever genstart og offline.
  - Der er sync-status i appen.
  - En ny enhed henter først, så den ikke overskriver kontoens data.
- **Backend**: Fastify + Postgres med RLS og roller (admin > træner > bruger). Den kører i Docker bag Cloudflare Tunnel og har natlig backup med testet gendannelse.
- **Migrering**: Import fletter backups ind i kontoen (uden dubletter), og den gamle web-app har kortet "Flyt til Android-appen".
- **Administrationsside** (`/admin`) for admin og trænere:
  - brugere, invitationer og roller
  - atletprofil (niveau og trin i alle 12 progressionstræer)
  - programbygger med de 6 indbyggede skabeloner og egne skabeloner
  - programguide med 10 spørgsmål (regelbaseret)
- **Programmer fra træneren** vises skrivebeskyttet i appen og kan kopieres.
- **Skabelonen "Begynder – Helkrop"** er tilføjet.
- **App-download** fra egen server (`/app`, `/app/version`). Appen tjekker selv for nye versioner og viser "Ny version tilgængelig".
- **Trænerindsigt** (fase 12): brugersiden på `/admin` viser træninger pr. uge, rekorder, maks-tests, 1RM og hele historikken.
- **Baggrundsalarm til intervaltimere** (EMOM, AMRAP, Tabata, Ladder).
- **Udstyr**: programmer fra skabeloner tilpasses Hjemme, Calisthenics-park, Fitnesscenter, CrossFit-box eller eget udstyr.
- **Lokal Git-server (Forgejo)** med privat kopi af repoet.
- **Kodereview** (sikkerhed, performance og korrekthed): fundene er verificeret og rettet, bl.a. sikrere sync, escaping, strammere RLS, refresh-grace, backup-fejlhåndtering og en migrate-tjeneste.
- **Tests**: 168 frontend-tests (inkl. regressionstest af alle skabeloner, progression, sync, migrering, guide og øvelses-id-kontrakt) og 86 backend-tests (roller, RLS, auth, sync, admin og distribution).

## Ændrede og nye filer (overblik)

| Område | Filer |
|---|---|
| App | `index.html`, `sw.js`, `css/app.css`, `js/app.js`, `js/templates.js`, nye: `js/platform.js`, `js/config.js`, `js/auth.js`, `js/ids.js`, `js/legacy.js`, `js/store.js`, `js/sync-map.js`, `js/sync.js`, `js/progression.js`, `js/guide.js`, `js/intervals.js`, `js/vendor/dexie.min.js` |
| Android | `android/` (Capacitor-projekt), `capacitor.config.json`, `package.json`, `scripts/build-web.js` |
| Server | `server/compose.yml`, `server/api/**` (routes: auth, users, sync, admin, admin-site, invite, app-dist, wellknown), `server/migrations/001_init.sql`, `002_admin.sql`, `003_review.sql`, `004_insight.sql`, `server/db/init/01-roles.sh`, `server/backup/*.sh`, `server/README.md` |
| Admin | `server/admin/` (`index.html`, `admin.css`, `api.js`, `ui.js`, `builder.js`, `views.js`, `insight.js`) |
| Tests | `test/*.test.js`, `test/fixtures/`, `test/__snapshots__/`, `server/api/test/*.test.ts` |
| Øvrigt | `.gitignore`, `.gitattributes`, `.dockerignore` |

## Næste skridt

1. **Version 1.5 på telefonen**: Installér den fra `/app` eller via USB, og test sync og intervaltimerens alarmer med slukket skærm.
2. **Proxmox-backup af serveren**: et dagligt vzdump-job efter kl. 03:00 med kun 14 dages opbevaring. Sættes op af Peter.
3. **Repoet**: Tag stilling til GitHub (offentligt, privat eller kun Forgejo). Privat lukker GitHub Pages.
4. **Eget app-ikon**: kræver et valg af motiv og farver.
5. **Forgejo**: CI-runner til automatiske tests ved hvert push (venter).
