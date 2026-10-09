# GOAT 2.6 — GitHub + Railway

Dla istniejącego repozytorium **Zerqoon/test3** użyj **UPDATE_V2_PL.md** i aktualizatora **FIX-GOAT-INSTALL.ps1**. Projekt pozostaje w **R3V0-Discord-Bot-v2**, a Railway Root Directory to **`/R3V0-Discord-Bot-v2`**. Poniższe kroki utworzenia nowego repozytorium dotyczą tylko osobnego nowego repo.

Kanały, dopisek klanu, role administracji i Twój osobisty dostęp są już ustawione w `config.json`. Bot działa po angielsku. Na Railway token wpisujesz w **Variables**, a baza trafia na trwały wolumen.

## 1. Aplikacja Discord

1. Otwórz https://discord.com/developers/applications i utwórz aplikację GOAT.
2. W zakładce **Bot** skopiuj token. Przy **Privileged Gateway Intents** włącz **Server Members Intent** oraz **Message Content Intent**.
3. W **OAuth2 → URL Generator** zaznacz `bot` i `applications.commands`, następnie uprawnienie **Administrator**. Otwórz wygenerowany link i dodaj bota do swojego serwera.
4. Przesuń rolę bota nad role osób, których pseudonimy i timeouty ma zmieniać. Discord nadal wymaga odpowiedniej hierarchii ról.

## 2. Pliki na GitHubie

**Dla Twojego istniejącego repozytorium Zerqoon/test3:** użyj `UPLOAD-GITHUB.ps1` według `UPDATE_V2_PL.md`. Projekt trafi do folderu **R3V0-Discord-Bot-v2**, więc ustaw **Root Directory: `/R3V0-Discord-Bot-v2`**. Skrypt umieszcza workflow testów w głównym folderze repozytorium. Zachowaj podłączony serwis i wolumen. Poniższe kroki opisują alternatywne utworzenie osobnego repozytorium.

1. Rozpakuj cały ZIP.
2. Utwórz repozytorium, np. `goat-clan-bot`. Możesz wybrać prywatne repozytorium i przyznać Railway dostęp do niego.
3. Wgraj **zawartość folderu GOAT-Clan-Bot do głównego katalogu repozytorium**. Po wejściu do repozytorium od razu powinno być widać `Dockerfile`, `package.json`, `package-lock.json`, `config.json` oraz foldery `src`, `scripts`, `tests` i `assets`.
4. Wgraj też `.github/workflows/ci.yml`, `.npmrc`, `.nvmrc`, `.gitignore` i `.dockerignore`. Jeśli korzystasz z GitHub Desktop, dodaj cały rozpakowany projekt i wykonaj commit oraz push. Przy wgrywaniu przez przeglądarkę możesz pominąć folder `dist` — Railway zbuduje go samodzielnie.
5. Token ustawiasz dopiero w Railway. Plik `.env.example` jest wzorem do lokalnego uruchamiania; prawdziwy `.env`, `node_modules` i pliki bazy nie powinny trafić do repozytorium.

Po pushu zakładka **Actions** uruchomi kompilację i lokalne testy. Testy nie wymagają tokenu Discorda.

W repozytorium **Zerqoon/test3** ustaw **Settings → Root Directory** na **`/R3V0-Discord-Bot-v2`**. W innym repozytorium wybierz ścieżkę folderu zawierającego `Dockerfile` i `package.json`; przy plikach w samym głównym katalogu ustawienie może pozostać domyślne.

## 3. Usługa na Railway

1. Otwórz https://railway.com i wybierz **New Project → Deploy from GitHub repo**.
2. Połącz GitHub, przyznaj dostęp do repozytorium i wybierz `goat-clan-bot`.
3. Jeśli pojawi się wybór, użyj **Add Variables**, aby ustawić token i wolumen przed pierwszym uruchomieniem. Jeśli Railway rozpoczęło wdrożenie automatycznie, po wykonaniu następnych kroków ponownie wykonaj Deploy.
4. W usłudze otwórz **Variables** i dodaj:

| Nazwa | Wartość |
| --- | --- |
| `DISCORD_TOKEN` | Twój token z zakładki Bot w Discord Developer Portal |
| `DATABASE_PATH` | `/app/data/goat.sqlite` |
| `RAILWAY_RUN_UID` | `0` |
| `LOG_LEVEL` | `info` — opcjonalnie |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `15` — zalecany czas na zamknięcie procesu przy aktualizacji |

`GUILD_ID` oraz `APPLICATION_ID` możesz pominąć. Bot rozpozna serwer po skonfigurowanym kanale nicków i zarejestruje komendy automatycznie.

## 4. Trwały wolumen

1. Dodaj **Volume** do projektu i przypnij go do usługi GOAT.
2. Ustaw **Mount Path** dokładnie na **`/app/data`**.
3. Zatwierdź oczekujące zmiany wraz ze zmiennymi usługi.

Na wolumenie będą statystyki, archiwum nicków, wpisy giveawayów, zapisane losowania, sprawy moderacyjne, kolejka logów, tickety, głosy, decyzje aplikacji, autorole i terminy usunięcia przypomnień. Aktualizacja kodu nie usuwa tych danych.

Railway montuje wolumen z uprawnieniami root, dlatego `RAILWAY_RUN_UID=0` pozwala procesowi z tego obrazu zapisywać bazę. Bot sprawdza, czy na Railway istnieje wolumen i czy `DATABASE_PATH` leży wewnątrz niego. Przy złym ustawieniu zobaczysz konkretny błąd w logach.

## 5. Start i ustawienia

| Ustawienie | Wartość |
| --- | --- |
| Builder | Wykrywany automatycznie z `Dockerfile` |
| Root Directory w Zerqoon/test3 | `/R3V0-Discord-Bot-v2` |
| Build Command | Pozostaw puste — instalację i kompilację wykonuje Dockerfile |
| Start Command | Pozostaw puste — obraz uruchamia `node dist/src/index.js` |
| Replicas | `1` |
| Serverless / usypianie usługi | Wyłączone |
| Restart Policy | `Always`, jeśli dostępne w Twoim planie; w przeciwnym razie `On Failure` |
| HTTP Healthcheck Path | Pozostaw puste |

Kliknij **Deploy**. W Build Logs powinien być użyty wykryty Dockerfile. W logach uruchomienia czekaj na **GOAT ready**; pole `version` powinno mieć `2.6.0`. Na Discordzie pojawią się komendy `/giveway-create`, `/messages` i pozostałe.

Bot jest procesem łączącym się z Discordem przez gateway. Domena publiczna i port HTTP nie są potrzebne do działania. Nie uruchamiaj równocześnie kopii na komputerze z tym samym tokenem.

## 6. Pierwszy import i aktualizacje

Po starcie bot zacznie pobierać wcześniejsze dostępne wiadomości. `/history-sync status` pokazuje postęp, a `/goat-status` stan usług. Po ukończeniu importu `/messages` uwzględnia też znalezione wpisy sprzed dodania bota. Wiadomości usuniętych wcześniej i niedostępnych kanałów Discord nie udostępnia.

Aktualizacje wysyłaj do podłączonej gałęzi GitHuba. Railway może wdrażać je automatycznie; zachowuj ten sam wolumen `/app/data` i nie zmieniaj ścieżki istniejącej bazy. Po restarcie bot wznowi trwałe zadania. Blokada bazy zapobiega dwóm procesom; po nagłym zakończeniu procesu może wygasać do 60 sekund.

## Kopie bazy

W terminalu działającego kontenera Railway uruchom `npm run backup`. Kopia pojawi się w **`/app/data/backups`** na tym samym wolumenie. Pobierz kopię poza usługę, jeśli chcesz zachować ją również po usunięciu całego wolumenu. Możesz także skonfigurować kopie wolumenu oferowane przez Railway w swoim planie.

Do odtworzenia: zatrzymaj usługę, umieść kopię jako `/app/data/goat.sqlite`, usuń stare pliki `goat.sqlite-wal` i `goat.sqlite-shm` należące do poprzedniej bazy, a następnie uruchom usługę. Pozostałe pliki projektu zostają na miejscu.

## Najczęstsze błędy

| Komunikat / objaw | Rozwiązanie |
| --- | --- |
| `set DISCORD_TOKEN` / błąd logowania | Ustaw token bota w Variables, zatwierdź zmiany i wykonaj Deploy |
| `attach a Railway volume` | Dodaj i przypnij wolumen do usługi z Mount Path `/app/data` |
| `DATABASE_PATH must point to a file inside...` | Ustaw `/app/data/goat.sqlite` i sprawdź Mount Path wolumenu |
| `EACCES` / `readonly database` | Ustaw `RAILWAY_RUN_UID=0` i ponownie wdróż usługę |
| `Disallowed intents` / kod `4014` | Włącz Server Members Intent i Message Content Intent w aplikacji Discorda |
| `Missing Permissions` | Sprawdź uprawnienia bota, hierarchię jego roli i dostęp do kanałów |
| Brak wykrytego Dockerfile | Umieść pliki projektu w głównym katalogu repozytorium albo popraw Root Directory |
| `database is already owned` | Ustaw jedną replikę; po nagłym crashu odczekaj wygaśnięcie blokady i uruchom usługę ponownie |

Komendy i opis wszystkich funkcji znajdziesz w `START_HERE_PL.md`. Wyniki lokalnej walidacji oraz granice testów są w `docs/VALIDATION.md`.

Źródła platformy: [GitHub deployment](https://docs.railway.com/quick-start), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Volumes](https://docs.railway.com/volumes), [Serverless](https://docs.railway.com/deployments/serverless).
