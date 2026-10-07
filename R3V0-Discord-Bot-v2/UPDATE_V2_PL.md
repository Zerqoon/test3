# GOAT 2.0 — aktualizacja GitHub + Railway

## Wgraj projekt

### Naprawa aktualizacji, gdy Railway nadal pokazuje 1.0.0

Pobierz pełny `GOAT-Clan-Bot-v2-Tickets.zip` oraz `INSTALL-AND-UPLOAD-GOAT.ps1` do Pobranych. Wklej w PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\zerqo\Downloads\INSTALL-AND-UPLOAD-GOAT.ps1"
```

Skrypt wybierze najnowszy pobrany ZIP o tej nazwie, zweryfikuje wersję 2.0.0 i pliki ticketów, uzupełni projekt na Pulpicie oraz wykona upload z kodu bezpośrednio rozpakowanego z ZIP-a. Lokalna baza i `.env` są zachowane. Na końcu pokaże commit wysłany do GitHuba. Jeśli pobierasz pliki do innego folderu, podaj pełną ścieżkę skryptu oraz parametr `-ZipPath "pełna ścieżka ZIP-a"`.

Log `version: 1.0.0` w Railway potwierdza uruchomiony stary kod. Porównaj commit z logiem skryptu. W usłudze Railway naciśnij **Ctrl+K → Deploy Latest Commit**, aby wdrożyć najnowszy commit podłączonej gałęzi `main`, z Root Directory `/R3V0-Discord-Bot-v2`. Zwykłe **Redeploy** odtwarza kod wybranego starego wdrożenia. Po prawidłowym uruchomieniu nowy proces zapisze `version: 2.0.0`, a panel pojawi się na `1557384522713276488`.

Dokumentacja Railway: [Deployment Actions](https://docs.railway.com/deployments/deployment-actions), [GitHub Autodeploys](https://docs.railway.com/deployments/github-autodeploys), [Keyboard Shortcuts](https://docs.railway.com/overview/keyboard-shortcuts).

### Standardowa aktualizacja z rozpakowanego folderu

Rozpakuj ZIP. Zawartość znajdującego się w nim folderu **GOAT-Clan-Bot** skopiuj do **C:\Users\zerqo\Desktop\GOAT-Clan-Bot**. Podmień kod, a zachowaj istniejący lokalny folder `data` oraz `.env`, jeśli używasz też wersji lokalnej.

Otwórz PowerShell i wklej:

```powershell
cd "C:\Users\zerqo\Desktop\GOAT-Clan-Bot"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\UPLOAD-GITHUB.ps1" -SourceDirectory "C:\Users\zerqo\Desktop\GOAT-Clan-Bot"
```

Potrzebny jest Git for Windows. Jeśli Git poprosi o logowanie, zaloguj się do swojego konta GitHub. Skrypt pobierze aktualną gałąź `main` z **Zerqoon/test3**, podmieni jej folder **R3V0-Discord-Bot-v2**, doda workflow sprawdzający ten podfolder i wykona zwykły commit oraz push. Pozostałe pliki repozytorium pozostaną zachowane. Token, lokalna baza i `node_modules` nie są wysyłane. Skrypt pracuje na tymczasowej kopii repozytorium; nie usuwa Twojej lokalnej bazy.

Przed wysłaniem skrypt sprawdza wersję 2.x, pliki ticketów, obrazek aplikacji i włączenie ticketów w `config.json`. Wyświetla faktyczny folder źródłowy oraz wersję. Jeśli podmienisz tylko skrypt, zostawiając stare pliki bota, wysyłanie zostanie zatrzymane. Po udanym pushu pokazuje SHA commitu: właśnie ten commit powinien być wdrożony na Railway. W logu nowego procesu `GOAT ready` ma pole `version: 2.0.0`.

Jeśli nie widać nowych funkcji, sprawdź na Discordzie `/ticket-panel`. Ta komenda występuje w nowym projekcie i publikuje / naprawia panel na skonfigurowanym kanale. Brak komendy może oznaczać uruchomiony starszy kod, brak rejestracji komend lub nieodświeżoną listę Discorda; porównaj commit i wersję w logu Railway. Jeżeli komenda istnieje, ale panel nie powstaje, odczytaj jej prywatny komunikat błędu i log `GOAT ticket panel needs attention` lub `GOAT ticket panel will retry` w Railway. Błąd dostępu albo niedostępny kanał Ticket Logs może zablokować publikację panelu.

Na Railway pozostaw ten sam serwis i wolumen. Ustaw **Settings → Root Directory** na **`/R3V0-Discord-Bot-v2`**. Build Command i Start Command pozostaw puste — budowanie i uruchamianie obsługuje dołączony `Dockerfile`. Po pushu uruchom Deploy, jeśli automatyczne wdrażanie nie jest włączone.

| Ustawienie | Wartość |
| --- | --- |
| `DISCORD_TOKEN` | Zachowaj token w Railway Variables |
| `DATABASE_PATH` | `/app/data/goat.sqlite` |
| `RAILWAY_RUN_UID` | `0` |
| Volume Mount Path | `/app/data` |
| Replicas | `1` |
| Serverless / usypianie | Wyłączone |

Baza jest aktualizowana automatycznie. Nie usuwaj starego wolumenu ani pliku SQLite. Statystyki, giveaway'e, zablokowane nicki i sprawy moderacyjne pozostają w tej bazie.

## Co zrobi bot po wdrożeniu

| Funkcja | Konfiguracja / działanie |
| --- | --- |
| Autorola ludzi | `1552638283748737094`: brakująca rola jest nadawana obecnym ludziom oraz nowym osobom, z uwzględnieniem limitów API Discorda |
| Przypomnienia | Wyłącznie osoby, które dołączą po pierwszym uruchomieniu wersji 2.0 i posiadają lub później dostaną rolę `718165098526670948` |
| Kanał przypomnienia | `1556640581613260810`: tylko ping tej osoby i prośba o prawdziwy Roblox `@username`, zamiast display name |
| Usuwanie przypomnienia | Po 60 sekundach; termin zapisany w SQLite, więc usuwanie działa także po restarcie |
| Obecni członkowie | Dostają brakującą autorolę, bez zbiorczego pingowania o nicki |
| Panel ticketów | `1557384522713276488`: **Clan Application** i **Support**, z dostarczonym logo GOAT |
| Ticket Logs | `1557404763136721017`: otwarcie, przejęcie, zmiany uczestników, zamknięcie, ponowne otwarcie i usunięcie |
| Logi ogólne | `1552635674790989865`: czytelne nazwy ustawień, uprawnienia opisane słownie i szczegóły działań ludzi |
| Giveaway | Jeden publiczny przycisk wejścia, obowiązkowy wybór roli, ping tylko tej roli i sprawdzanie aktualnej roli uczestnika |

Bot nie wysyła osobnego logu każdej automatycznej autoroli, poprawki nicku ani utworzenia kanału ticketu w logach ogólnych. Po uzupełnieniu autoroli wysyła jedno podsumowanie. Logi pojawiają się z około 8-sekundowym opóźnieniem i grupują do pięciu embedów w jednej wiadomości; duże wpisy są rozdzielane według limitów Discorda. Powtarzający się raport importu oraz komunikaty online są domyślnie wyciszone. Długie szczegóły trafiają do pliku TXT, krótkie wpisy pozostają bez dodatkowych załączników. Kolejka logów i zamrożone grupy przetrwają restart.

Rola dopisku **` | GOAT`** jest nadal ustawiona osobno jako `nickname.roleId: 1552474081054564402`, zgodnie z wcześniejszą konfiguracją. Rola wymagana do przypomnienia jest w `usernameReminder.roleId`, a domyślna rola giveawayu w `giveaways.defaultRoleId`. Wszystkie ustawienia są w `config.json`.

## Obsługa ticketów

Kanał powstaje z prywatnymi uprawnieniami już w momencie utworzenia. Dostęp otrzymują autor ticketu, wskazani uczestnicy, skonfigurowana obsługa i Twój zapisany dostęp osobisty. Discord przyznaje właścicielowi serwera i osobom z **Administrator** dostęp niezależnie od nadpisanych uprawnień kanału.

**Clan Application** otrzymuje dostarczony obrazek jako wzór oraz angielską listę: mastery z widocznym `@username`, gamepasses, inventory i stats. **Support** otrzymuje prośbę o opis problemu. Panel nie ujawnia ról obsługi ani osobistych ID dostępu.

| Komenda / przycisk | Działanie |
| --- | --- |
| `/ticket-panel` | Opublikowanie lub naprawienie jednego panelu; ponowny start go nie duplikuje |
| `/ticket-list` | Prywatna lista ostatnich ticketów dla obsługi |
| `/ticket-add user:...` | Dodanie konkretnej osoby do aktualnego otwartego ticketu |
| `/ticket-remove user:...` | Odebranie dodatkowego dostępu uczestnikowi |
| **Claim** | Przejęcie przez obsługę; aktualny dostęp sprawdzany ponownie |
| **Close** | Autor lub obsługa podaje powód w formularzu |
| `/ticket-close reason:...` | Zamknięcie aktualnego ticketu przez obsługę |
| **Reopen** | Ponowne otwarcie przez autora lub obsługę, jeżeli nie ma innego aktywnego ticketu tego typu |
| **Delete** | Tylko obsługa, po zamknięciu i potwierdzonym dostarczeniu zapisu rozmowy do Ticket Logs |
| `/ticket-repair` | Odtworzenie prywatnych uprawnień istniejących ticketów |
| `/autorole-sync` | Ponowienie uzupełnienia roli ludzi |

Każda osoba może mieć jednocześnie jeden aktywny ticket aplikacyjny i jeden Support. Zamknięte kanały są tylko do odczytu. Zapis HTML obejmuje wszystkie dostępne strony wiadomości i usunięte wiadomości, które bot wcześniej zaobserwował. Pliki mogą być podzielone przy dużej rozmowie. Tekst jest zachowany w zapisie; linki do załączników Discorda mogą wygasnąć. Błąd odczytu rozmowy lub dostarczenia logu blokuje usunięcie kanału i uruchamia ponowienie zadania.

Bot potrzebuje włączonych **Server Members Intent** i **Message Content Intent**. Jego najwyższa rola musi być powyżej nadawanej autoroli oraz odpowiednio powyżej osób, którym zmienia nicki lub nadaje timeouty. Szczegóły pełnej instalacji: `RAILWAY_SETUP_PL.md`.
