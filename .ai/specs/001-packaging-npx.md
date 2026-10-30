# 001 — Packaging: `npx`, dane w `.ai/onni/`, zero tarcia przy starcie

Status: ZAIMPLEMENTOWANE 2026-07-10 · Fala: 1 · Zależy od: —

## Cel

Użytkownik w katalogu swojego repo wpisuje **jedną komendę** i po kilku
sekundach ma otwarty cockpit w przeglądarce. Bez instalacji, bez konfiguracji,
bez zajętego portu, bez pytań.

## UX (jak cep)

```bash
cd moje-repo
npx onni                      # ...i tyle. Otwiera się przeglądarka.
```

- Jeśli port zajęty → bierzemy następny wolny, bez pytania.
- Jeśli brak `claude`/`gh` → cockpit i tak startuje, w headerze czerwony chip
  z jednozdaniową instrukcją instalacji. Nigdy nie blokujemy startu.
- Żadnego `init` wymaganego. `onni init` zostaje jako *opcjonalny* scaffolding
  przykładów.

## Zakres

1. **Nazwa paczki — ROZSTRZYGNIĘTE**: `@onni/work` (publikacja w
   org scope) **plus** alias unscoped `onni` (`alias-onni/`: bin-shim z
   zależnością na scoped paczkę), bo `npx onni` instaluje paczkę unscoped —
   nazwa była wolna, zajmujemy ją. Bin: `onni` + `onni-cli`.
2. **Katalog danych: `.onni/` → `.ai/onni/`** (ustalenie z Piotrem; skille
   zostają w konwencji `.ai/skills/`, wspólnej z innymi narzędziami):
   ```
   .ai/
     skills/                  # skille repo (bez zmian, konwencja wspólna)
     Onni Work/
       workflows/*.yaml       # chainy użytkownika (commitowalne)
       skills/*.md            # skille tylko-onniowe (commitowalne)
       config.json            # OPCJONALNY (maxParallel, skillsRepos, model)
       runs.json              # index tasków            (gitignored)
       runs/<id>.ndjson       # eventy per task          (gitignored)
       runs/<id>.handoff.md   # dziennik per task (007)  (gitignored)
       todos.json             # globalny inbox (007)     (gitignored)
       .gitignore             # generowany automatycznie
   ```
3. **Auto-port**: próbuj 4321, potem kolejne (wzorzec `launch.mjs` janitora:
   `net.createServer` + `canListen`). Wypisz finalny URL, otwórz przeglądarkę
   po pozytywnym `GET /api/health`.
4. **Publish**: `npm publish` z `prepublishOnly: build`; `files` już zawiera
   `dist`, `web`, `scripts`. Test na czystej maszynie przez `npx`.

## Poza zakresem

- Migracja danych z `.onni/` (nikt jeszcze nie używa — twarda zmiana ścieżki).
- Autoupdate, telemetria — nie robimy.

## Projekt techniczny

- `src/index.ts`: stała `DATA_DIR = '.ai/onni'`; funkcja `pickPort(start)`
  (pętla `canListen`); `openUrl` po healthchecku zamiast po starcie.
- `src/workflows/load.ts`: `WORKFLOWS_DIR = '.ai/onni/workflows'`.
- `src/skills.ts`: źródła `.ai/skills` + `.ai/onni/skills`.
- `src/runs/store.ts`: bez zmian logiki, tylko ścieżka bazowa.
- Opcjonalny `config.json` czytany przez zod z **pełnym fallbackiem defaultów**
  (brak pliku = pełna funkcjonalność).

## Kroki implementacji

1. Zmiana ścieżek danych + generowany `.gitignore`.
2. `pickPort` + healthcheck-gated `openUrl`.
3. Rename paczki w `package.json` (po decyzji o nazwie), `README` update.
4. `npm publish` + test `npx` na czystym repo.

## Kryteria akceptacji

- Na maszynie bez klonu Onni Work: `npx <paczka>` w dowolnym repo → cockpit otwarty,
  chipy statusu poprawne, task da się odpalić.
- Dwa cockpity w dwóch repo jednocześnie → drugi sam bierze inny port.
- `git status` w repo użytkownika po sesji: tylko `.ai/onni/` (z poprawnym
  gitignore — żadnych runs.json w statusie).
