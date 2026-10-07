# GOAT 2.1 — aktualizacja GitHub + Railway

Pobierz najnowszy **GOAT-Clan-Bot-v2-Tickets.zip** oraz **INSTALL-AND-UPLOAD-GOAT.ps1** do Pobranych. Nazwa ZIP-a pozostaje taka sama; nowy projekt w środku ma wersję **2.1.0**.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\zerqo\Downloads\INSTALL-AND-UPLOAD-GOAT.ps1"
```

Skrypt wybierze najnowszy ZIP, sprawdzi wersję i obecność systemu głosowania, zaktualizuje `C:\Users\zerqo\Desktop\GOAT-Clan-Bot`, a następnie podmieni `R3V0-Discord-Bot-v2` w repozytorium **Zerqoon/test3**, wykona commit i zwykły push do `main`. Wysyła źródła bezpośrednio z rozpakowanego ZIP-a. Zachowuje lokalną bazę i `.env`; token oraz baza nie trafiają na GitHub. Potrzebny jest Git for Windows i możliwość zalogowania do GitHuba. Na końcu otrzymasz SHA wysłanego commitu.

Jeżeli pliki są w innym folderze, podaj pełną ścieżkę skryptu oraz `-ZipPath "pełna ścieżka do ZIP-a"`. Alternatywnie rozpakuj projekt i uruchom dołączony `UPLOAD-GITHUB.ps1` z parametrem `-SourceDirectory` wskazującym folder zawierający `package.json`.

W usłudze Railway użyj **Ctrl+K → Deploy Latest Commit** z gałęzi `main`. **Root Directory: `/R3V0-Discord-Bot-v2`**. Zwykłe Redeploy używa kodu wybranego wdrożenia. Porównaj commit ze skryptem; nowy log `GOAT ready` i `/goat-status` powinny pokazywać **2.1.0**. Panel oraz istniejące wiadomości ticketów są odświeżane po starcie. `/ticket-panel` naprawia panel ręcznie.

Dokumentacja: [Deployment Actions](https://docs.railway.com/deployments/deployment-actions), [GitHub Autodeploys](https://docs.railway.com/deployments/github-autodeploys), [Keyboard Shortcuts](https://docs.railway.com/overview/keyboard-shortcuts).

| Railway | Ustawienie |
| --- | --- |
| Root Directory | `/R3V0-Discord-Bot-v2` |
| Build / Start Command | Puste — używany jest dołączony Dockerfile |
| `DISCORD_TOKEN` | Dotychczasowy token w Variables |
| `DATABASE_PATH` | `/app/data/goat.sqlite` |
| Volume | Zachowaj istniejący, Mount Path `/app/data` |
| `RAILWAY_RUN_UID` | `0` |
| Replicas | `1` |
| Serverless | Wyłączone |

Baza aktualizuje się automatycznie do schematu 3. Zachowane są statystyki, giveaway'e, archiwum nicków, sprawy moderacyjne, tickety i granica pierwszego dołączenia dla przypomnień. Nie usuwaj wolumenu ani pliku SQLite. Samo pobranie ZIP-a lub skopiowanie plików na komputer nie zmienia działającej usługi Railway.

## Ticket i głosowanie

Panel **Clan Application / Support** jest na `1557384522713276488`. Przed utworzeniem obu rodzajów ticketu pojawia się formularz wymagający Roblox **@username**, zamiast display name. Nazwa jest sprawdzana pod względem formatu; bot nie potwierdza własności konta Roblox.

Jedna osoba może mieć **jeden aktywny ticket łącznie**, z przerwą **5 minut** i limitem **3 ticketów na godzinę**. Limit serwera wynosi **50 aktywnych ticketów**. Powtarzanie przycisków nie tworzy kolejnych kanałów. Formularze wygasają po 15 minutach; limity utworzeń działają po restarcie.

Kanał jest prywatny od chwili utworzenia. Dostęp mają autor, dodani uczestnicy i skonfigurowana obsługa. Discord przyznaje osobom z Administrator i właścicielowi serwera dostęp niezależnie od nadpisań. Publiczny panel nie pokazuje ID ani ról uprawnionych osób.

Aplikacja otrzymuje **jeden embed** z username i checklistą:

1. Mastery z widocznym username jak na dołączonym przykładzie.
2. Gamepasses.
3. Inventory.
4. Stats.

Dla nowej aplikacji na `1557433699572777000` pojawia się Discord nickname, Roblox username oraz **Vote Yes / Vote No**. Głosowanie trwa **10 minut**, wymaga **minimum 3 głosów**, a większość Yes przyjmuje aplikację; większość No odrzuca. Pierwszy klik nie kończy głosowania. Remis lub zbyt mało głosów pozostawia ticket do ręcznej decyzji. Support służy prywatnej pomocy i nie jest objęty głosowaniem.

Każdy członek serwera będący człowiekiem, poza aplikującym, ma jeden głos i może go zmienić. Głosy osób, które wyszły z serwera, są odrzucane podczas końcowego liczenia. `tickets.voting.voterRoleIds` pozwala ograniczyć głosowanie do wskazanych ról; bot sprawdza rolę przy kliknięciu i ponownie na końcu.

**Approve / Reject** w tickecie oraz `/ticket-approve reason:...` i `/ticket-reject reason:...` są dostępne tylko skonfigurowanej administracji i osobistemu dostępowi właściciela. Uzasadnienie trafia do DM aplikującego. Decyzja automatyczna lub ręczna zamyka ticket do odczytu i wysyła angielski embed DM z wynikiem, powodem i wykonawcą. Zamknięte DM nie zatrzymują decyzji. Akceptacja nie nadaje automatycznie roli klanowej.

Głosy, wynik, etap zamykania i dostarczenie DM są zapisane w SQLite. Po restarcie bot wznawia pracę. Zakończona decyzja nie jest losowana ani liczona ponownie. Niepewne wysyłki używają nonce Discorda; przy długiej awarii na granicy wysyłki i zapisu nadal może być potrzebne ręczne sprawdzenie DM.

Starsze tickety dostają poprawiony wygląd. Te, które powstały przed formularzem i nie mają Roblox username, nie są automatycznie poddawane głosowaniu. Administracja może rozstrzygnąć je ręcznie.

## Czytelne logi

| Zdarzenia | Kanał |
| --- | --- |
| Usunięcia, edycje i GIF-y ze wszystkich kanałów, także ticketów | `1557439487813091358` |
| Otwarcia, przejęcia, uczestnicy, zamknięcia i zapis rozmowy ticketów | `1557439533979803678` |
| Dołączenia i wyjścia: Discord ID, data i wiek konta, data dołączenia / wyjścia | `1557439665378959491` |
| Role, kanały, moderacja i pozostałe działania administracyjne | `1557440463974436956` |

Log zamknięcia ticketu pokazuje powód, wynik, osoby, czas i **treść rozmowy bezpośrednio w embedzie**. Przy długiej rozmowie widać ostatnich osiem wiadomości; pełna chronologiczna historia jest w załączniku **TXT**, bez HTML. Zachowane są również usunięte wiadomości, które bot wcześniej zaobserwował. Linki do załączników Discorda mogą wygasnąć.

Logi grupują do pięciu embedów w jednej wiadomości po około 8 sekundach, w granicach limitów Discorda. Własne rutynowe autorole, poprawki nicków i operacje tworzenia ticketów nie wywołują osobnych logów administracyjnych. Dopisanie podglądu GIF-a nie powoduje dodatkowego logu edycji. Użytkowe wiadomości bota i jego logi nie generują pętli logowania.

| Obsługa ticketów | Działanie |
| --- | --- |
| `/ticket-panel`, `/ticket-list` | Naprawienie panelu / prywatna lista |
| Claim | Przejęcie przez obsługę |
| Close, `/ticket-close reason:...` | Zamknięcie z powodem; wycofanie aplikacji anuluje jej głosowanie |
| Approve / Reject, `/ticket-approve`, `/ticket-reject` | Ręczna decyzja aplikacji |
| `/ticket-add`, `/ticket-remove` | Zmiany dostępu konkretnej osoby |
| Reopen | Ponowne otwarcie, gdy użytkownik nie ma innego aktywnego ticketu; po przyjęciu lub odrzuceniu tylko administracja |
| Delete | Tylko administracja, po potwierdzonym dostarczeniu całej rozmowy do Ticket Logs |
| `/ticket-repair` | Odtworzenie prywatnych uprawnień |

Zamknięte kanały pozostają tylko do odczytu do czasu użycia Delete. Błąd odczytu rozmowy albo dostarczenia logu blokuje usunięcie. Komendy, przyciski i formularze administracyjne sprawdzają aktualne uprawnienia.

## Pozostałe systemy

Autorola ludzi pozostaje `1552638283748737094`, dopisek ` | GOAT` używa roli `1552474081054564402`. Przypomnienie na `1556640581613260810` dotyczy tylko nowych osób z rolą `718165098526670948`, pinguje tę osobę i znika po 60 sekundach. Aktualizacja nie pinguje zbiorowo obecnych członków. Giveaway nadal ma obowiązkowy wybór roli, jeden publiczny przycisk wejścia i świeże sprawdzanie wymaganej roli.

Bot wymaga **Server Members Intent** i **Message Content Intent**. Rola bota musi być powyżej nadawanych ról i osób, którym zmienia nickname lub timeout. Wszystkie ustawienia są w `config.json`. Pełna instalacja: `RAILWAY_SETUP_PL.md`; lokalna walidacja: `docs/VALIDATION.md`.
