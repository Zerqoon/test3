# GOAT 2.6.1 — aktualizacja GitHub + Railway

Pobierz **GOAT-Clan-Bot-Value-API-Community-v2.6.1.zip** i rozpakuj projekt. Nowe funkcje oraz prostą instalację opisuje **COMMUNITY-START-PL.md**. Projekt ma wersję **2.6.1**. Dołączony FIX-GOAT-INSTALL.ps1 i dotychczasowy FIX-GOAT-INSTALL-API.ps1 rozpoznają najnowszy pełny ZIP bota.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\zerqo\Downloads\FIX-GOAT-INSTALL.ps1"
```

Skrypt wybierze najnowszy ZIP, sprawdzi wersję i obecność systemu głosowania, zaktualizuje `C:\Users\zerqo\Desktop\GOAT-Clan-Bot`, a następnie podmieni `R3V0-Discord-Bot-v2` w repozytorium **Zerqoon/test3**, wykona commit i zwykły push do `main`. Wysyła źródła bezpośrednio z rozpakowanego ZIP-a. Zachowuje lokalną bazę i `.env`; token oraz baza nie trafiają na GitHub. Potrzebny jest Git for Windows i możliwość zalogowania do GitHuba. Na końcu otrzymasz SHA wysłanego commitu.

Jeżeli pliki są w innym folderze, podaj pełną ścieżkę skryptu oraz `-ZipPath "pełna ścieżka do ZIP-a"`. Alternatywnie rozpakuj projekt i uruchom dołączony `UPLOAD-GITHUB.ps1` z parametrem `-SourceDirectory` wskazującym folder zawierający `package.json`.

W usłudze Railway użyj **Ctrl+K → Deploy Latest Commit** z gałęzi `main`. **Root Directory: `/R3V0-Discord-Bot-v2`**. Zwykłe Redeploy używa kodu wybranego wdrożenia. Porównaj commit ze skryptem; nowy log `GOAT ready` i `/goat-status` powinny pokazywać **2.6.1**. Panel oraz istniejące wiadomości ticketów są odświeżane po starcie. `/ticket-panel` naprawia panel ręcznie.

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

Baza aktualizuje się automatycznie do schematu 9. Zachowane są statystyki, giveaway'e, archiwum nicków, sprawy moderacyjne, tickety i granica pierwszego dołączenia dla przypomnień. Nie usuwaj wolumenu ani pliku SQLite. Samo pobranie ZIP-a lub skopiowanie plików na komputer nie zmienia działającej usługi Railway.

## Rekrutacja 20 osób i blacklist w 2.6

| Komenda | Działanie |
| --- | --- |
| `/clan-off` | Wyłącza nowe aplikacje. Przycisk Clan Application znika. Embed pokazuje **Recruitment Closed** i rzeczywisty licznik. |
| `/open-ticket count:0` | Ustawia **Clan Full · 20/20** i usuwa przycisk aplikacji. |
| `/open-ticket count:5` | Otwiera nabór na **5 wolnych miejsc**; przycisk pokazuje **15/20**. |
| `/open-ticket count:20` | Otwiera wszystkie 20 miejsc, jeżeli nie ma aktywnych rezerwacji. |
| `/clan-status` | Prywatnie pokazuje miejsca zajęte, wolne, zarezerwowane i stan panelu. |

Komendy są widoczne w menu Discorda; ich wykonanie nadal sprawdza dotychczasową administrację oraz Twój zapisany ID. Publiczny panel nie opisuje uprawnień ani osób z dostępem.

Limit jest stały: **20**. `count` przyjmuje **0–20** i oznacza **wolne miejsca**, po uwzględnieniu otwartych aplikacji. Przykład: masz 2 aktywne aplikacje i ustawiasz `count:5` → 13 miejsc zajętych, 2 zarezerwowane, 5 wolnych. Przy `count:0` → 18 zajętych + 2 zarezerwowane = 20/20; zgłoszenia i głosowania pozostają aktywne. Nie możesz ustawić 20 wolnych miejsc przy aktywnej rezerwacji. Polecenie służy również do aktualizacji wolnych miejsc, gdy ktoś opuszcza klan.

Nowy ticket Clan rezerwuje jedno miejsce. Akceptacja przez głosowanie lub komendę zamienia rezerwację w miejsce zajęte. Odrzucenie, wycofanie lub usunięcie kanału bez decyzji zwalnia rezerwację. Support nie zużywa miejsc i jest dostępny do otwierania od 3 PM do 10 PM (Europe/Warsaw); administracja może użyć `/support-open` poza godzinami. `/clan-off` zachowuje aktualny licznik i istniejące rozmowy; zatrzymuje nowe aplikacje i ponowne otwieranie nierozpatrzonych aplikacji. Po zajęciu lub zarezerwowaniu ostatniego miejsca przycisk znika, a embed pokazuje **Clan Full · 20/20**. Po zwolnieniu rezerwacji wraca do aktywnego stanu, chyba że nabór został ręcznie wyłączony.

Dostępność jest widoczna w embedzie; `/clan-status` daje prywatną odpowiedź. Licznik aktualizuje ten sam panel bez tworzenia kolejnych wiadomości. Ustawienia, rezerwacje i decyzje przetrwają restart. Formularz otwarty przed zamknięciem naboru lub przed zajęciem ostatniego miejsca jest ponownie sprawdzany przy wysłaniu. Równoczesne zgłoszenia nie przekroczą limitu.

Przy aktualizacji istniejące nierozpatrzone, aktywne aplikacje dostają rezerwacje. Bot nie zgaduje liczby obecnych członków klanu: **ustaw rzeczywistą liczbę wolnych miejsc przez `/open-ticket count:...` albo użyj `/clan-off`**. Jeśli stara wersja utworzyła ponad 20 aplikacji, rozmowy pozostają; nowe zgłoszenia są zablokowane, a akceptacja nie przekroczy 20 zajętych miejsc.

Rola **1557809384166391918** jest w `tickets.clanBlacklistRoleIds` i `linkFilter.gifBlockedRoleIds`:

- Blokuje **tworzenie Clan Application** i ponowne otwieranie nierozpatrzonej aplikacji. Support pozostaje dostępny; istniejące tickety nie są masowo zamykane.
- Blokuje **wszystkie GIF-y**, w tym Tenor, Giphy, KLIPY, GIFV i załączniki GIF. Blokada ma pierwszeństwo przed rolami GIF, administracją i kanałem `1557577086351179866`.
- GIF zostaje usunięty, a krótka informacja po angielsku znika po 10 sekundach. Nie ujawnia ID roli ani zasad dostępu.
- Zwykły tekst, screeny i dozwolone linki YouTube/TikTok/Roblox nadal działają. Dotychczasowe zasady zaproszeń i innych domen pozostają.

Jedna zmiana ustawienia naboru trafia do Ticket Logs. Rezerwacje aktualizują licznik i korzystają z dotychczasowych logów ticketów, bez dodatkowego strumienia logów.

## Nowe logi i filtr linków

Po uruchomieniu sprawdź **2.6.1** w `/goat-status`, następnie użyj **`/message-logs test`**. Ta komenda wysyła jeden test bezpośrednio do **1557439487813091358**. **`/message-logs status`** prywatnie pokaże kanał, uprawnienia, czas ostatniej zaobserwowanej edycji/usunięcia i błąd dostarczenia. Po poprawieniu dostępu **`/message-logs retry`** ponowi zapisane logi.

Logi korzystają z surowych zdarzeń Gateway i bazy, także gdy Discord.js nie ma już wiadomości albo kanału w pamięci. Edycje częściowe zachowują niezmienione załączniki i podglądy. Wiadomości ludzi na kanałach logów również są logowane. Wiadomości botów są oznaczane osobno, aby nie tworzyć pętli. Błędny pojedynczy wpis jest zachowywany do naprawy i nie zatrzymuje pozostałych.

Bot potrzebuje dostępu do kanałów źródłowych, **Manage Messages** do usuwania oraz **View Channel / Send Messages / Embed Links / Attach Files / Read Message History** na kanale logów. **Message Content Intent** musi być włączony w Developer Portal → Bot. Treści, których bot nigdy nie dostał, oraz usunięć sprzed instalacji lub z okresu offline nie da się odzyskać z Discorda.

| Wiadomość zwykłego członka | Zasada |
| --- | --- |
| Zaproszenie `discord.gg` / `discord.com/invite` / `discordapp.com/invite` | Usuwane; wyjątek ma dotychczasowa administracja i Twój zapisany ID |
| TikTok / YouTube / Roblox, również prawdziwe subdomeny i `youtu.be` | Dozwolone |
| Inna domena | Usuwana, chyba że dopiszesz domenę w `linkFilter.allowedDomains` |
| Tenor / Giphy / KLIPY — także Klipy clips i static.klipy.com | Dozwolone bez roli blokującej GIF-y |
| Inne GIF-y, bezpośrednie pliki GIF i GIF-y z Discorda | Dozwolone na `1557577086351179866`, dla administracji lub dodanej roli GIF, jeżeli osoba nie ma roli blokującej |
| Zwykłe screeny PNG/JPG jako załączniki | Dozwolone |

**Dodawanie rang:** `/link-filter allow-role role:...` — natywny wybór roli. **Usuwanie wyjątku:** `/link-filter remove-role role:...`. **Prywatny podgląd:** `/link-filter status`. Dodatkowe role początkowo są puste; administracja ma wyjątek od razu. Zmiany ról zapisują się w SQLite i pozostają po redeployu. Rola GIF pozwala wysyłać GIF-y także z Discorda i z innych domen, ale nie daje wyjątku dla zaproszeń ani zwykłych linków spoza listy.

Filtr sprawdza nowe wiadomości i edycje, zanim wpis na kanale nicków zostanie przepisany do embeda. Nie przegląda i nie usuwa zbiorowo starej historii. Usuwa wiadomość i wysyła krótką angielską informację z pingiem tylko autora. Ostrzeżenie znika po **10 sekundach**. Próby tej samej osoby na tym samym kanale w ciągu 10 sekund nie tworzą kolejnych ostrzeżeń ani nie przedłużają poprzedniego. Kolejka ostrzeżeń i osobny mechanizm usuwania działają również po restarcie; stare niewysłane ostrzeżenia wygasają. Jeden czytelny log z powodem i pełną treścią w TXT trafia do **1557439487813091358**. Nieudane usunięcia wracają do kolejki; przed ponowieniem bot sprawdza aktualne role i treść. Podglądy dozwolonych filmów pobierane z CDN Discorda nie są traktowane jak nielegalne linki. Dowolne przekierowania zewnętrznych serwisów nie są otwierane przez bota.

## Klipy, wyjątek GIF i nowe DM

`1557577086351179866` pozwala na **wszystkie GIF-y**, w tym pliki GIF z Discorda. Blokada zaproszeń i innych zwykłych linków nadal obowiązuje. Poza tym kanałem każdy może używać **Tenor, Giphy i KLIPY**; inne źródła wymagają wyjątku roli. Bot rozpoznaje rzeczywisty adres, także natywny podgląd GIFV. Dozwolony GIF nie przepuszcza dodatkowego GIF-a z zabronionego źródła w tej samej wiadomości.

W `config.json` sekcja `linkFilter` zawiera:

- `allowedDomains`: dozwolone domeny linków;
- `gifProviderDomains`: źródła GIF-ów/klipów, wspólne dla filtra i logów;
- `allowApprovedGifs: true`: dozwolone źródła dostępne wszystkim;
- `unrestrictedGifChannelIds`: kanały bez ograniczeń GIF-ów;
- `notifications.deleteAfterSeconds: 10`: czas usunięcia ostrzeżenia.

Dodając nowy serwis GIF-ów, wpisz jego właściwą domenę w **`allowedDomains` i `gifProviderDomains`**. Dla KLIPY jest już `klipy.com`; subdomeny, w tym `static.klipy.com`, działają automatycznie.

Od pierwszego uruchomienia **2.4** nowe nadanie roli **1552474081054564402** uruchamia DM z prośbą o Roblox **@username** na **1556640581613260810** oraz przyciskiem otwarcia kanału. Dotyczy to również osób, które były wcześniej na serwerze i dopiero teraz dostają rolę. Osoby posiadające ją już przy uruchomieniu nie otrzymują zbiorowego DM. Kolejka i granica uruchomienia są zapisane w bazie. Jedna osoba dostaje jedno skutecznie zakończone przypomnienie; odebranie i ponowne nadanie roli nie spamuje DM. Wyłączone DM są widoczne prywatnie w `/goat-status`. Bot musi być połączony z Discordem, aby odbierać zdarzenia; zdarzeń nadania roli z długiego okresu offline nie odtwarza z samej listy aktualnych członków.

Dopisek **GOAT •** oraz automatyczna stopka GOAT zostały usunięte z embedów. Dopisek nicku **` | GOAT`** nadal działa. Stare identyfikatory archiwum username pozostają rozpoznawane po aktualizacji.

## Ticket i głosowanie

Panel **Clan Application / Support** jest na `1557384522713276488`. Przed utworzeniem obu rodzajów ticketu pojawia się formularz wymagający Roblox **@username**, zamiast display name. Nazwa jest sprawdzana pod względem formatu; bot nie potwierdza własności konta Roblox.

Jedna osoba może mieć **jeden aktywny ticket łącznie**, z przerwą **5 minut** i limitem **3 ticketów na godzinę**. Limit serwera wynosi **50 aktywnych ticketów**. Powtarzanie przycisków nie tworzy kolejnych kanałów. Formularze wygasają po 15 minutach; limity utworzeń działają po restarcie.

Kanał jest prywatny od chwili utworzenia. Dostęp mają autor, dodani uczestnicy i skonfigurowana obsługa. Discord przyznaje osobom z Administrator i właścicielowi serwera dostęp niezależnie od nadpisań. Publiczny panel nie pokazuje ID ani ról uprawnionych osób.

Aplikacja otrzymuje **jeden embed** z username i checklistą:

1. Mastery z widocznym username jak na dołączonym przykładzie.
2. Gamepasses.
3. Inventory.
4. Stats.
5. **Can you be AFK 24/7?** — odpowiedź Yes / No w tickecie.

Przyciski aplikacji są w jednym rzędzie: **Claim · Close · Start Vote**. Roblox username jest wyróżniony na samej górze embeda. Support ma Claim i Close.

Głosowanie nie zaczyna się przy otwarciu ticketu. Administracja uruchamia je przyciskiem **Start Vote** albo `/ticket-start-vote`. Dopiero wtedy pojawia się panel **Vote Yes / Vote No** na `1557433699572777000` i zaczyna się **3-minutowy licznik**. **3 Yes od razu akceptują**, **3 No od razu odrzucają** aplikację. Po 3 minutach wygrywa przewaga oddanych głosów, nawet 1:0. **Remis lub brak głosów** zostawia decyzję administracji. Kolejne kliknięcie Start Vote i restart nie wydłużają terminu.

Każdy członek widzący panel, poza aplikującym i botami, ma jeden głos i może go zmienić przed zakończeniem. Nie ma wymogu dodatkowej roli ani minimalnej frekwencji. Wyjście kogoś z serwera nie usuwa już oddanego głosu. Starsze opcje `durationSeconds`, `minimumVotes` i `voterRoleIds` nie zmieniają nowych stałych zasad 180 sekund / 3 głosy.

**Approve / Reject zostały usunięte z ticketu**. Ręczna decyzja pozostaje przez `/ticket-approve reason:...` i `/ticket-reject reason:...`, z aktualnym sprawdzeniem uprawnień. Wynik zapisuje się przed operacjami Discorda; ticket zostaje zamknięty do odczytu, rozmowa trafia do logów i bot wysyła angielski embed DM z wynikiem, powodem i wykonawcą. Zamknięte DM nie blokują decyzji. Akceptacja nie nadaje automatycznie roli klanowej.

Głosy, wynik, etap zamykania i dostarczenie DM są zapisane w SQLite. Po restarcie bot wznawia pracę. Zakończona decyzja nie jest losowana ani liczona ponownie. Niepewne wysyłki używają nonce Discorda; przy długiej awarii na granicy wysyłki i zapisu nadal może być potrzebne ręczne sprawdzenie DM.

Starsze tickety dostają nowy wygląd w tej samej wiadomości. Nierozstrzygnięte głosowania starego automatycznego systemu czekają teraz na Start Vote, z zachowaniem zapisanych głosów. Rozpoczęte już decyzje kończą się bez ponownego liczenia. Aktualizacja nie zeruje statystyk ani granicy nowych osób do przypomnień.

## Czytelne logi

| Zdarzenia | Kanał |
| --- | --- |
| Usunięcia, edycje i GIF-y ze wszystkich kanałów, także ticketów | `1557439487813091358` |
| Otwarcia, przejęcia, uczestnicy, zamknięcia i zapis rozmowy ticketów | `1557439533979803678` |
| Dołączenia i wyjścia: Discord ID, data i wiek konta, data dołączenia / wyjścia | `1557439665378959491` |
| Role, kanały, moderacja i pozostałe działania administracyjne | `1557440463974436956` |

Log zamknięcia ticketu pokazuje powód, wynik, osoby, czas i **treść rozmowy bezpośrednio w embedzie**. Przy długiej rozmowie widać ostatnich osiem wiadomości; pełna chronologiczna historia jest w załączniku **TXT**, bez HTML. Zachowane są również usunięte wiadomości, które bot wcześniej zaobserwował. Linki do załączników Discorda mogą wygasnąć.

Przyciski i komendy potwierdzają interakcję przed dłuższymi operacjami. Wstępne pobranie wszystkich członków działa w tle; logi startują od razu. Logi usunięć korzystają z zapisanej treści bez czekania na audyt. Częściowe edycje używają bazy również wtedy, gdy wiadomość wypadła z pamięci Discord.js. `/goat-status` pokazuje błędy dostarczania logów; zablokowany kanał nie zatrzymuje innych kanałów.

Logi grupują do pięciu embedów w jednej wiadomości po około 0,7 sekundy, w granicach limitów Discorda. Własne rutynowe autorole, poprawki nicków i operacje tworzenia ticketów nie wywołują osobnych logów administracyjnych. Dopisanie podglądu GIF-a nie powoduje dodatkowego logu edycji. Użytkowe wiadomości bota i jego logi nie generują pętli logowania.

| Obsługa ticketów | Działanie |
| --- | --- |
| `/ticket-panel`, `/ticket-list` | Naprawienie panelu / prywatna lista |
| Claim | Przejęcie przez obsługę |
| Close, `/ticket-close reason:...` | Zamknięcie z powodem; wycofanie aplikacji anuluje jej głosowanie |
| Start Vote, `/ticket-start-vote` | Uruchomienie głosowania przez administrację |
| `/ticket-approve`, `/ticket-reject` | Ręczna decyzja aplikacji |
| `/ticket-add`, `/ticket-remove` | Zmiany dostępu konkretnej osoby |
| Reopen | Ponowne otwarcie, gdy użytkownik nie ma innego aktywnego ticketu; po przyjęciu lub odrzuceniu tylko administracja |
| Delete | Tylko administracja, po potwierdzonym dostarczeniu całej rozmowy do Ticket Logs |
| `/ticket-repair` | Odtworzenie prywatnych uprawnień |

Zamknięte kanały pozostają tylko do odczytu do czasu użycia Delete. Błąd odczytu rozmowy albo dostarczenia logu blokuje usunięcie. Komendy, przyciski i formularze administracyjne sprawdzają aktualne uprawnienia.

## Czytelniejsze komendy

`/help` ma przyciski **Activity / Tickets / Giveaways / Tools**. Pierwsza wiadomość jest publiczna, a instrukcje kategorii prywatne. Nowa komenda **`/ticket`** grupuje `panel`, `list`, `add`, `remove`, `close`, `start-vote`, `approve`, `reject`, `repair`; stare komendy ticketów również działają. Uprawnienia są nadal sprawdzane przy wykonaniu.

Panel ticketów ma większy baner, dwie czytelne kategorie i wspólny formularz @username. W tickecie widać od razu username, autora, status i osobę obsługującą. Start Vote pozostaje ręczny, a panel głosowania pokazuje liczniki **Yes / No do 3**.

## Widoczność komend

`/messages`, `/leaderboard` i alias `/leadboard` oraz `/help` są dostępne wszystkim i publikują odpowiedź na kanale. Komendy są rejestrowane bez domyślnego ograniczenia do roli administratora. Działania administracyjne nadal wymagają skonfigurowanego dostępu sprawdzanego przez bota. Jeśli Discord ukrywa komendę na serwerze, sprawdź **Use Application Commands** w uprawnieniach kanału oraz **Server Settings → Integrations → GOAT** i usuń stare ograniczenia odpowiednich komend.

## Tworzenie embedów

`/embed [channel] [ping-role] [ping-user]` otwiera angielski formularz z tytułem, wiadomością w embedzie, wiadomością poza embedem, adresem HTTPS obrazka i kolorem HEX, np. `#22D3EE`. Kanał domyślny to kanał wywołania komendy. Rola i osoba są opcjonalne, wybierane przez natywne pickery Discorda. Bot automatycznie dopisuje wybrane pingi nad embedem; nie pinguje niewybranych ról, osób ani @everyone wpisanego w tekst. Dostęp działa przez dotychczasowe ustawienia administracji.

Embed ma podany tytuł i treść, bez automatycznego dopisku GOAT. Po wysłaniu formularza bot publikuje embed i prywatnie pokazuje link do wiadomości. Przy problemie z wysyłką zachowuje wiadomość w bazie i ponawia próbę, również po restarcie. Powtórzona wysyłka tego samego formularza nie tworzy dodatkowej wiadomości. Rola musi być mentionable albo bot musi mieć uprawnienie Mention Everyone. `/goat-status` pokazuje liczbę oczekujących embedów.

## Pozostałe systemy

Autorola ludzi pozostaje `1552638283748737094`, dopisek ` | GOAT` używa roli `1552474081054564402`. Przypomnienie na `1556640581613260810` dotyczy tylko nowych osób z rolą `718165098526670948`, pinguje tę osobę i znika po 60 sekundach. Aktualizacja nie pinguje zbiorowo obecnych członków. Giveaway nadal ma obowiązkowy wybór roli, jeden publiczny przycisk wejścia i świeże sprawdzanie wymaganej roli.

Bot wymaga **Server Members Intent** i **Message Content Intent**. Rola bota musi być powyżej nadawanych ról i osób, którym zmienia nickname lub timeout. Wszystkie ustawienia są w `config.json`. Pełna instalacja: `RAILWAY_SETUP_PL.md`; lokalna walidacja: `docs/VALIDATION.md`.
