# GOAT 2.5 — uruchomienie

Projekt jest przygotowany dla Twojego serwera. Kanały, rola klanu, dwie role administracji oraz Twój osobisty dostęp są już wpisane w `config.json`. Cały interfejs bota jest po angielsku.

**Aktualizujesz Zerqoon/test3 i Railway: otwórz UPDATE_V2_PL.md.** Do projektu dołączony jest `UPLOAD-GITHUB.ps1`, który podmienia podfolder `R3V0-Discord-Bot-v2` i wysyła commit. Pełne ustawienia hostingu są w `RAILWAY_SETUP_PL.md`. Poniższa instalacja dotyczy uruchomienia na własnym komputerze.

1. Zainstaluj **Node.js 24 LTS, co najmniej 24.15** z https://nodejs.org/ .
2. Rozpakuj cały ZIP do jednego folderu.
3. Otwórz https://discord.com/developers/applications , utwórz aplikację **GOAT**, przejdź do **Bot** i utwórz / skopiuj token.
4. W **Bot → Privileged Gateway Intents** włącz dokładnie **Server Members Intent** oraz **Message Content Intent**. Presence Intent nie jest potrzebny.
5. Zaproś bota: **OAuth2 → URL Generator → `bot` + `applications.commands` → Administrator**. Otwórz wygenerowany link i wybierz serwer GOAT.
6. W ustawieniach serwera przesuń rolę bota **nad role osób**, którym ma zmieniać pseudonimy lub nadawać timeouty. Administrator nie omija hierarchii ról ani ochrony właściciela serwera.
7. Uruchom **START-GOAT.bat**. Za pierwszym razem otworzy `.env`: wklej token po `DISCORD_TOKEN=`, zapisz plik i zamknij Notatnik. Uruchom plik BAT jeszcze raz.
8. Przy pierwszym starcie zainstalują się zależności, projekt się skompiluje, komendy pojawią się na serwerze, a bot rozpocznie import historii.

Nie musisz wpisywać ID serwera — bot rozpozna je po kanale z nickami. `GUILD_ID` i `APPLICATION_ID` można zostawić puste. Tokenu nie wklejaj na Discord ani do publicznego repozytorium.

## Najważniejsze komendy

Nowość **2.5**: `/clan-off` wyłącza nabór i daje szary, nieklikalny przycisk **20/20**. `/open-ticket count:5` otwiera **5 wolnych miejsc**, czyli **15/20**. `/clan-status` pokazuje szczegóły prywatnie. Limit 20 uwzględnia aktywne aplikacje; akceptacja zajmuje miejsce, a odrzucenie lub wycofanie je zwalnia. Support działa również po wyłączeniu naboru. Ustaw rzeczywistą liczbę wolnych miejsc po aktualizacji. Rola `1557809384166391918` blokuje aplikacje Clan i wszystkie GIF-y, także na kanale z wyjątkiem. Szczegóły są w **UPDATE_V2_PL.md**.

| Komenda | Działanie |
| --- | --- |
| `/giveway-create` lub `/giveaway-create` | Formularz: tytuł, nagroda, czas, opis, natywny wybór wymaganej roli; potem podgląd i Publish Giveaway |
| `/giveway-create winners:2 channel:#giveaways` | Dwie osoby wygrywają; publikacja na wybranym kanale |
| `/giveaway-list` | Lista oraz ID giveawayów |
| `/giveaway-end id:...` | Zakończenie i losowanie od razu |
| `/giveaway-reroll id:...` | Ponowne losowanie z wyłączeniem poprzednich zwycięzców |
| `/giveaway-cancel id:... reason:...` | Anulowanie bez losowania |
| `/messages user:...` | Dzisiaj, bieżący tydzień, bieżący miesiąc i wszystkie zindeksowane wiadomości |
| `/leaderboard period:weekly` | Ranking aktywności |
| `/ban user:... reason:... [duration:1d]` | Ban stały lub czasowy, log i próba dostarczenia DM |
| `/mute user:... reason:... duration:10m` | Prawdziwy Discord Timeout, maksymalnie 28 dni |
| `/unmute`, `/unban` | Usunięcie timeoutu / bana |
| `/warn`, `/warnings`, `/case` | Ostrzeżenia i historia spraw |
| `/history-sync status` / `/history-sync start` | Postęp importu / ponowienie importu |
| `/username-retry` | Ponowienie konwersji zablokowanych przez błąd uprawnień lub kopiowania |
| `/username-remove message-id:... reason:...` | Usunięcie konkretnego embeda przez uprawnioną osobę |
| `/nickname-sync` | Ponowne sprawdzenie dopisku klanu |
| `/welcome-preview` | Prywatny podgląd karty welcome |
| `/goat-status` | Stan bota i zaległe zadania |
| `/autorole-sync` | Uzupełnienie roli wszystkich ludzi |
| `/ticket-panel`, `/ticket-list` | Panel i prywatna lista ticketów |
| `/ticket-add user:...`, `/ticket-remove user:...` | Dostęp konkretnej osoby do aktualnego ticketu |
| `/ticket-approve reason:...`, `/ticket-reject reason:...` | Ręczna decyzja aplikacji do klanu, zamknięcie i DM |
| `/ticket-close reason:...`, `/ticket-repair` | Zamknięcie lub naprawienie prywatnych uprawnień |

Obsługiwane czasy: `1s`, `10s`, `1m`, `1 minute`, `30 minutes`, `1h 30m`, `1 day`, `1w`. Bot odrzuca niepoprawne wartości zamiast zgadywać jednostkę.

## Jak działa kanał nicków

Bot kopiuje zawartość wpisu do własnego embeda. **Tytuł to pseudonim widoczny na serwerze**, miniatura to avatar autora. Zapisuje autora, ID i czas. Następnie usuwa oryginał. Użytkownik nie może edytować wiadomości należącej do bota. Przy błędzie wysyłki lub kopiowania plików oryginał zostaje zachowany. Starsze dostępne wpisy na tym kanale też są konwertowane automatycznie.

Statystyki liczą oryginalny wpis tylko raz. Wiadomość bota, która go zastępuje, nie zwiększa licznika.

## Historia i ograniczenia Discorda

Pierwszy import może potrwać przy dużej historii. Bot czyta wszystkie dostępne strony wiadomości oraz dostępne aktywne i archiwalne wątki. `/history-sync status` pokazuje postęp. Tydzień zaczyna się w poniedziałek, a okresy są liczone w strefie **Europe/Warsaw**.

**Nie da się policzyć wiadomości usuniętych przed dodaniem bota ani odzyskać niedostępnych kanałów.** Wszystkie znalezione wcześniejsze wiadomości zostaną policzone. Wiadomości, które GOAT już zaobserwował, pozostają w licznikach nawet po usunięciu.

Discord nie zawsze ujawnia sprawcę pojedynczego usunięcia. Bot pokazuje wykonawcę dostarczonego przez audyt przy rolach, kanałach i moderacji. Przy usunięciach oznacza niepewne przypisanie jako kandydat z audytu, a brak danych jako Unknown. Krótkie zdarzenia mają czytelny embed; długie szczegóły są zachowane w TXT. Zewnętrzne linki do załączników mogą wygasnąć. W archiwum nicków pliki są kopiowane przed usunięciem źródła. Logi są grupowane, a rutynowe własne działania bota wyciszone. Szczegóły autoroli, przypomnień i ticketów są w `UPDATE_V2_PL.md`.

DM jest wysyłany, gdy Discord na to pozwala. Osoba z zamkniętymi DM nie otrzyma wiadomości; wynik dostarczenia jest odnotowany w sprawie. Bot nie wymaga Presence Intent i nie korzysta z webhooks.

## Ważne przy restartach

- Zachowuj folder **data**: zawiera SQLite ze statystykami, archiwum i giveawayami. Nie podmieniaj go przy aktualizacji kodu.
- Nie uruchamiaj dwóch kopii naraz. Blokada SQLite zatrzyma drugą kopię; po nagłym crashu wygasa po 60 sekundach.
- Na Railway zachowuj wolumen **/app/data** pomiędzy wdrożeniami. Bot wykrywa brak wolumenu i zatrzymuje start zamiast zapisać dane na nietrwałym dysku. Szczegóły są w `RAILWAY_SETUP_PL.md`.
- Na PC bot działa, dopóki proces jest uruchomiony. Działanie całą dobę wymaga stale działającego PC lub hostingu Node.js. Docker jest przygotowany w projekcie.
- `npm run backup` tworzy bezpieczną kopię bazy, także gdy bot działa: lokalnie w `data/backups`, na Railway w `/app/data/backups`. Aby ją przywrócić, zatrzymaj bota, podmień plik SQLite na kopię i usuń wyłącznie stare pliki `goat.sqlite-wal` / `goat.sqlite-shm`, jeśli zostały po poprzedniej bazie.

Podgląd welcome znajduje się w **docs/goat-welcome-preview.png**. Okrąg na podglądzie jest zastępowany prawdziwym avatarem dołączającej osoby.

Projekt został sprawdzony lokalnie. Test na prawdziwym serwerze wymaga Twojego tokenu i odpowiednich ustawień aplikacji.
