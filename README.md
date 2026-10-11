# power-krop – Calisthenics, Powerløft & Military Styrke

Web-app (PWA) til Android, der kan installeres på hjemmeskærmen og virker offline. Den er bygget til Samsung Galaxy S24 Ultra, men kører i alle moderne browsere.

## Funktioner
- **Øvelsesbibliotek** med 99 øvelser:
  - Animerede start- og slutbilleder, teknikpunkter og muskelgrupper
  - Søgning på YouTube, og du kan gemme din egen video pr. øvelse
- **12 progressionstræer**: pull-up, muscle-up, push-up, dips, HSPU, håndstand, planche, front lever, L-sit, core, ben og rows.
- **5 skabeloner**, der hver kan køres **2–6 dage om ugen** på niveauerne begynder, øvet og avanceret:
  - Military Calisthenics – Styrke (ladders, EMOM, maks-sæt, AMRAP)
  - Calisthenics Styrke
  - Skills: Muscle-up, Planche & Front lever
  - Powerløft (lineær / 5/3/1 / blokperiodisering)
  - Hybrid: Powerløft + Calisthenics
- **Programbygger**:
  - Byg et program fra bunden, eller tilpas en skabelon
  - Opsætning af dage, øvelser, varianter, sæt, reps, tid, kg, %TM, RPE og pause
  - Formater: almindelige sæt, Ladder, EMOM, AMRAP og Tabata
- **Træningsmode**:
  - Pausetimer med lyd og vibration
  - Intervaltimere
  - Logning af reps, kg og RPE
  - Skærmen holdes tændt under træning
- **Progression**:
  - Automatiske forslag (dobbelt progression og forslag om næste trin i træet), som altid kan overskrives manuelt
  - 1RM og træningsmax til de %-baserede løft
- **Statistik**: rekorder, grafer, maks-tests og historik.
- **Data**: Alt gemmes kun på telefonen. Du kan tage backup via eksport og import (JSON).

## Udgiv på GitHub Pages
1. Opret et nyt repository på github.com, f.eks. `stalkrop`. Det skal være **Public**, eller også skal du have GitHub Pro til private Pages.
2. Upload alle filerne fra denne mappe. Du kan trække dem ind via **Add file → Upload files** eller bruge git:
   ```bash
   git init
   git add .
   git commit -m "StålKrop v1"
   git branch -M main
   git remote add origin https://github.com/<dit-brugernavn>/stalkrop.git
   git push -u origin main
   ```
3. Gå til **Settings → Pages**, vælg **Deploy from a branch**, branch `main` og mappe `/ (root)`, og tryk **Save**.
4. Efter cirka 1 minut ligger appen på `https://<dit-brugernavn>.github.io/stalkrop/`.

## Installér på din S24 Ultra
- **Chrome**: Åbn linket → menu **⋮** → **Installer app** (eller **Føj til startskærm**).
- **Samsung Internet**: menu **≡** → **Tilføj side til** → **Startskærm**.

Appen åbner derefter i fuld skærm som en almindelig app, og øvelsesbillederne caches, så den virker offline.

## Opdatering
Når du ændrer filer, skal du hæve `VERSION` i `sw.js` (f.eks. `stalkrop-v1.0.1`), så telefonerne henter den nye version.

## Lokal test
```bash
node serve.js
```
Åbn derefter http://localhost:8080.

## Kreditering
Øvelsesbilleder: [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense / public domain).
