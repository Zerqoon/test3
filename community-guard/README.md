# Community Guard — Discord BOT

Polski bot do administracji, informacji, regulaminu, logów, trudnych poziomów oraz ekonomii. Projekt zawiera gotowe ID, źródła TypeScript, czcionki Canvas, testy, Dockerfile i konfigurację Railway.

**Zacznij od [SZYBKI-START.md](SZYBKI-START.md).** Uzupełniasz tylko token, Application ID i ID serwera. Nazwę bota, akcent, walutę i teksty paneli zmieniasz w `config/server.json`.

Po zmianie treści regulaminu zwiększ `panels.rulesVersion` i opublikuj nowy panel. Przyciski starszej wersji wymagają wyświetlenia aktualnego regulaminu.

## Co działa

- Moderacja: warny z numerem sprawy, historia i cofanie ostrzeżeń, timeout, kick, ban/unban, clear, pseudonimy, role, slowmode i lock/unlock.
- Regulamin z przyciskiem akceptacji i zapisem wersji; panele informacji oraz zasad poziomów i ekonomii.
- Ogłoszenia: formularz, prywatny podgląd, publikacja przyciskiem.
- Logi dołączeń i wyjść z avatarem, wiadomości usuniętych i edytowanych. Długie teksty i zbiorcze usunięcia mają pełną znaną treść w załączniku TXT.
- Audyt: zmiany ról i uprawnień, kanałów i serwera, bany, kicki, zaproszenia, webhooki oraz inne dostępne wpisy audytu Discord. Wykonawca pochodzi z wpisu Discord. Dodatkowo zmiany profilu/avatara oraz wejścia/wyjścia na voice.
- Community po dołączeniu, kumulacyjne role poziomów, synchronizacja obecnych członków.
- Trudne XP z antyspamem oraz karty Canvas 1200 px: profil, awans i portfel. Avatar pochodzi z konta sprawdzanej osoby.
- Praca, daily, serie nagród, przelewy z opłatą, sklep, ekwipunek, tytuły, eliksiry, ranking i historia ekonomii.
- SQLite WAL i transakcje, ochrona przed podwójną wypłatą/zakupem/przelewem, trwała kolejka niewysłanych logów, kopie bazy i healthcheck Railway.

## Wpisane role i kanały

| Rola                     | ID                    |
| ------------------------ | --------------------- |
| Owner                    | `1547346866927304704` |
| Moderator                | `1547346876246786151` |
| Community — automatyczna | `1547346877429719121` |
| Poziom 5                 | `1549339887361200170` |
| Poziom 10 — zdjęcia      | `1549339888476758106` |
| Poziom 20 — GIF-y        | `1549339889248763914` |
| Poziom 30                | `1549339890259460096` |
| Poziom 50                | `1549339891131744297` |

| Kanał               | ID                    |
| ------------------- | --------------------- |
| Awanse              | `1554971115976138864` |
| Ogólne logi         | `1549346936484794379` |
| Zmiany / audit logs | `1549346912723804191` |
| Komendy             | `1549346772931842169` |

Wszystkie komendy użytkowników działają wyłącznie w kanale komend. Wskazane role Owner i Moderator oraz właściciel serwera mogą używać ich wszędzie. `/admin` jest tylko dla Ownera lub właściciela serwera. Sama rola Administrator o innym ID nie omija tych zasad.

Zwykłe wiadomości ludzi w kanale komend są usuwane, również wiadomości administracji. Odpowiedzi botów i komend pozostają. Wyjątek administracji dotyczy miejsca używania komend. Przyciski opublikowanego regulaminu działają na kanale publikacji.

## Ustawienia Discord

W https://discord.com/developers/applications utwórz aplikację i bota. W **Bot → Privileged Gateway Intents** włącz **Server Members Intent** i **Message Content Intent**. Presence Intent nie jest potrzebny. Aplikacje podlegające weryfikacji mogą wymagać zatwierdzenia privileged intents przez Discord.

W **OAuth2 → URL Generator** wybierz `bot` i `applications.commands`. Nadaj:

| Uprawnienia bota                                   | Zastosowanie                                           |
| -------------------------------------------------- | ------------------------------------------------------ |
| View Channels, Send Messages, Read Message History | Odczyt, komendy i logi                                 |
| Embed Links, Attach Files                          | Panele i Canvas                                        |
| Manage Messages                                    | Clear i usuwanie wiadomości naruszających ograniczenia |
| Manage Roles                                       | Community, poziomy, zwykłe role i nadpisania kanałów   |
| View Audit Log                                     | Sprawca i szczegóły zmian                              |
| Moderate Members                                   | Timeout                                                |
| Kick Members, Ban Members                          | Kick, ban, unban                                       |
| Manage Nicknames                                   | Pseudonimy                                             |
| Manage Channels                                    | Slowmode i blokady                                     |

Bot nie wymaga Administrator. Musi mieć dostęp i odpowiednie zezwolenia na wszystkich skonfigurowanych kanałach, także prywatnych. Kanały logów udostępnij administracji.

Hierarchia: **Owner → Moderator → rola bota → role poziomów / Community / zwykłe role**. Rola bota musi być nad rolami, którymi zarządza, i nad osobami, które moderuje. Moderator nie moderuje Ownera, innego Moderatora ani osoby z równą/wyższą rolą. Owner również respektuje natywną hierarchię, jeśli nie jest właścicielem serwera.

Community i role poziomów nie mogą nadawać uprawnień administracji — bot odrzuci ich automatyczne nadanie. Zwykła komenda roli chroni Ownera, Moderatora i role poziomów przed ręcznym przydzieleniem. Owner zmienia poziomy przez `/admin poziom`.

Community jest przyznawana po dołączeniu. Przy Membership Screening bot czeka na jego ukończenie. `/admin synchronizacja` nadaje Community istniejącym członkom i wyrównuje role poziomów. Po wyjściu poziom i saldo pozostają; po powrocie bot odtwarza role wynikające z poziomu.

## Zdjęcia i GIF-y

Na kanałach rozmów wyłącz **Attach Files** i **Embed Links** dla @everyone/Community. Zezwól na **Attach Files** dla poziomu 10 i **Embed Links** dla poziomu 20. Role są kumulacyjne, więc poziom 20 zachowuje też poziom 10.

Domyślny `mediaGuard` usuwa rozpoznane obrazy poniżej poziomu 10, pliki GIF, typowe linki Tenor/Giphy/Gifer i podglądy `gifv` poniżej poziomu 20. Administracja ma wyjątek. Natywne Attach Files nie rozróżnia zdjęcia i GIF-a; bot uzupełnia tę kontrolę. Nietypowe strony i animowane WebP/APNG mogą nie zostać wykryte. Bot nie pobiera każdego załącznika. `moderation.mediaGuard=false` wyłącza kontrolę treści i pozostawia role oraz natywne uprawnienia.

## Trudne poziomy

Domyślnie **10–16 XP**, najwyżej co **90 sekund**, za tekst zawierający co najmniej **15 liter/cyfr** i 5 różnymi znakami. Same linki, pingi, krótkie teksty i zalew powtarzanych liter nie dają XP. Ostatnie 40 nagrodzonych tekstów chroni przed powtórkami przez 6 godzin. Edycja wiadomości nie dodaje XP. Boty i kanały komend, logów oraz awansów są pomijane.

Limit: **1200 XP dziennie**, według Europe/Warsaw. Próg łączny: `120 × poziom² + 300 × poziom`. Maksymalny poziom 100. Sklep nie sprzedaje XP ani dostępu do zdjęć/GIF-ów. Nie ma pasywnego XP za voice.

| Poziom | Łącznie XP | Wykorzystane limity dzienne 1200 XP* |
| ------ | ---------: | -----------------------------------: |
| 5      |      4 500 |                                    4 |
| 10     |     15 000 |                                   13 |
| 20     |     54 000 |                                   45 |
| 30     |    117 000 |                                   98 |
| 50     |    315 000 |                                  263 |

\* To liczba limitów, a nie gwarantowany czas awansu. Zmiana dnia może przypaść w trakcie sesji. Realny postęp zależy od aktywności. Role niższych progów pozostają po awansie.

## Ekonomia

- Start: 0 Kryształów; nazwę waluty zmienisz w konfiguracji.
- Praca: 70–120 co godzinę. Eliksir daje +30% wypłaty przez 6h.
- Daily: co 24h, 250 + 25 za każdy kolejny dzień serii, maksymalnie 400 przy serii 7. Przerwa ponad 48h resetuje serię.
- Przelew 100 kosztuje nadawcę 103; odbiorca dostaje 100. Opłata 3% jest doliczana i zaokrąglana w górę.
- Tytuły są trwałe; można je kupić raz i aktywować na profilu. Eliksiry są zużywalne i nie nakładają się.
- Historia jest zapisywana dla nagród, zakupów, transferów i zmian Ownera. Saldo nie może być ujemne.

## Komendy

| Komenda                                                       | Dostęp            |
| ------------------------------------------------------------- | ----------------- |
| `/pomoc`, `/ping`, `/regulamin`                               | Użytkownik        |
| `/info serwer`, `/info osoba`, `/info bot`                    | Użytkownik        |
| `/poziom`, `/profil` — własna lub inna osoba                  | Użytkownik        |
| `/ranking typ:xp` lub `typ:balance`                           | Użytkownik        |
| `/ekonomia saldo`, `praca`, `daily`, `przelew`                | Użytkownik        |
| `/ekonomia sklep`, `kup`, `ekwipunek`, `uzyj`, `historia`     | Użytkownik        |
| `/moderacja warn`, `sprawy`, `unwarn`, `timeout`, `untimeout` | Moderator / Owner |
| `/moderacja kick`, `ban`, `unban`, `clear`, `nick`, `rola`    | Moderator / Owner |
| `/moderacja slowmode`, `lock`, `unlock`, `/ogloszenie`        | Moderator / Owner |
| `/admin diagnostyka`, `publikuj`, `synchronizacja`            | Owner             |
| `/admin poziom`, `waluta`, `backup`                           | Owner             |

Moderacja i administracja odpowiadają prywatnie. Historia ekonomii, ekwipunek i przelewy też są prywatne. Karty poziomu, portfela i wypłat w kanale komend są publiczne. Poza kanałem komend odpowiedzi administracji są prywatne.

`/lock` blokuje wysyłanie dla @everyone i Community oraz zachowuje wcześniejsze nadpisania w bazie. Inne role z osobnym Allow mogą nadal pisać. `/unlock` odtwarza zapisane nadpisania wysyłania. Zapis pozostaje również przy przerwanym lock; można ponowić unlock. `clear` pomija wiadomości starsze niż 14 dni.

## Lokalnie — Windows / PowerShell

Zainstaluj **Node.js 24 LTS**, minimum 24.17. Otwórz PowerShell w folderze projektu:

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
npm run check
npm test
npm run build
npm start
```

Uzupełnij trzy wartości Discord w `.env`. Rozwój: `npm run dev`. Wymuszona rejestracja komend: `npm run commands:deploy`. Podglądy Canvas bez tokenu: `npm run preview` → `previews/`.

## GitHub

Utwórz **nowe, puste repozytorium** na https://github.com/new. W folderze projektu, w którym jest package.json:

```powershell
cd "C:\Users\zerqo\Documents\community-guard"
git init
git branch -M main
git add .
git commit -m "Initial community bot"
git remote add origin https://github.com/TWOJ_LOGIN/TWOJE_NOWE_REPO.git
git push -u origin main
```

Podmień folder i adres repo. `.gitignore` pomija `.env`, bazę, dane i node_modules. Kolejne zmiany: `git add .`, `git commit -m "Update bot"`, `git push`. Przez stronę GitHub użyj Add file → Upload files i wyślij **zawartość rozpakowanego folderu** z zachowaniem podfolderów. Sam ZIP w repo nie jest projektem gotowym do budowania.

## Railway

1. **New Project → Deploy from GitHub repo** i repo bota.
2. Jeśli package.json, Dockerfile i railway.json są w głównym katalogu, pozostaw Root Directory puste. Przy folderze nadrzędnym wpisz ścieżkę do community-guard.
3. Variables: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DATABASE_PATH=/data/community.sqlite`, `AUTO_REGISTER_COMMANDS=true`, `NODE_ENV=production`.
4. **Dodaj Volume do usługi bota, Mount Path `/data`**. Sam railway.json nie tworzy Volume. Bez niego dane nie przetrwają wymiany kontenera.
5. **1 replika**, wyłącz Serverless/App Sleeping. To bot ze stałym połączeniem Discord, nie Cron. Nie uruchamiaj tego samego tokenu jednocześnie lokalnie i na Railway.
6. Dockerfile instaluje zależności i kompiluje TypeScript. Start: `node dist/index.js`. Nie trzeba wpisywać Build/Start Command. `/health` zwraca 200 po zalogowaniu i inicjalizacji. `/health/live` sprawdza proces. Railway przekazuje PORT.
7. Po wpisie **Bot gotowy** uruchom `/admin diagnostyka`, potem `/admin synchronizacja` i `/admin publikuj`. Wybierz kanał publikacji regulaminu, informacji i przewodnika.

Bot ma automatyczną rejestrację komend po zmianie definicji i restart po braku połączenia z Discord przez 5 minut. Powtórne połączenia obsługuje discord.js. Aktualizacja GitHub wywołuje wdrożenie w usłudze połączonej z tym repo.

## Dane i ograniczenia logów

Treść wiadomości w SQLite: 7 dni, maksymalnie 50 000; sprzątanie co godzinę. Historia ekonomii i identyfikatory wykonanych operacji: 90 dni. XP, saldo, ekwipunek, sprawy i akceptacje pozostają. Retencję zmieniasz w config. Wysłane logi Discord nie są automatycznie usuwane.

Bot widzi zdarzenia otrzymywane podczas działania. Nie odzyska wiadomości sprzed pierwszego uruchomienia lub z czasu przerwy. Brak wcześniejszej treści jest opisany. Załączniki są zapisane jako nazwy i linki, bez archiwizacji plików; linki mogą wygasnąć. Sprawca pojedynczego usunięcia nie jest zgadywany: sam MessageDelete go nie podaje. Komendy moderacji i wpisy audytu pojawiają się na kanale zmian. Audyt Discord może zawierać zbiorcze akcje i opóźnienia.

Kolejka niewysłanych logów pozostaje w SQLite i ponawia wysyłkę z rosnącym odstępem. Sprawdź /admin diagnostyka, jeśli stale rośnie.

Kopie SQLite tworzą się mniej więcej raz na dobę, z kontrolą po restarcie; zostaje ostatnich 7. Ręcznie: `/admin backup`. Pliki są w `backups/` obok bazy. Kopia w tym samym Volume nie chroni przed usunięciem całego Volume — używaj też backupów Railway lub pobieraj kopie na komputer.

Przywracanie: zatrzymaj bota, zachowaj dotychczasową bazę i jej pliki `-wal`/`-shm`, skopiuj backup pod ścieżkę DATABASE_PATH, przenieś stare `-wal`/`-shm` poza katalog aktywnej bazy i uruchom bota. Nie wymieniaj bazy przy działającym procesie.

## Gdy coś nie działa

| Objaw                        | Sprawdź                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| Brak komend                  | Applications.commands, Application ID, Guild ID, AUTO_REGISTER_COMMANDS |
| Invalid token / 401          | Token w Variables i Developer Portal                                    |
| Disallowed intents / 4014    | Server Members Intent i Message Content Intent                          |
| Brak Community lub ról       | Hierarchia, Manage Roles, ID; Membership Screening                      |
| Brak logów / rosnąca kolejka | View Channel, Send Messages, Embed Links, Attach Files; View Audit Log  |
| Utrata salda po redeploy     | Volume /data i DATABASE_PATH wskazujący /data/community.sqlite          |
| Brak Canvas                  | Attach Files oraz assets/fonts w repo; działa fallback tekstowy         |
| Brak XP                      | Minimum treści, cooldown, limit, powtórzenia i pomijany kanał           |
| Lock nie blokuje roli        | Ta rola ma osobny overwrite Allow                                       |

## Kod i walidacja

Stack: Node.js 24, TypeScript, discord.js 14, @napi-rs/canvas, better-sqlite3, Zod, Pino. Wersje są przypięte w package-lock.json. Czcionki mają własny plik licencji w assets/fonts.

`src/commands` — komendy i panele; `src/events` — zdarzenia; `src/services` — baza, poziomy, dostęp, logi, role i kopie; `src/canvas` — karty; `config` — serwer i sklep; `scripts` — komendy i podglądy; `tests` — logika, uprawnienia, media i renderowanie. GitHub Actions kontroluje typy, testy i build.

Testy nie wymagają tokenu. Lokalna walidacja nie obejmuje Twoich prawdziwych ról, kanałów, połączenia Discord ani wdrożenia Railway — do tego użyj konfiguracji i diagnostyki po uruchomieniu. Obraz Docker jest przygotowany; jego budowę wykonuje Railway.

Dokumentacja: [discord.js](https://discord.js.org/docs/packages/discord.js/14.27.0), [Discord intents](https://docs.discord.com/developers/events/gateway), [Discord permissions](https://docs.discord.com/developers/topics/permissions), [Railway Volumes](https://docs.railway.com/volumes), [healthchecks](https://docs.railway.com/deployments/healthchecks), [config as code](https://docs.railway.com/config-as-code/reference).
