# GOAT 2.6 — cały projekt bota

Ten ZIP zawiera cały bot: Value API, nowy Welcome Canvas, tickety, aplikacje, głosowania, moderację, username DM, GIF-y, logi i giveawaye, a także poniższe nowe funkcje.

## Co działa automatycznie

- **Support: 3 PM–10 PM**, czyli 15:00–22:00, codziennie według **Europe/Warsaw**. Bot sam uwzględnia czas letni i zimowy. O 22:00 przycisk Support znika; o 15:00 pojawia się ponownie. Istniejące rozmowy pozostają otwarte.
- **Rekrutacja:** `/clan-off` usuwa przycisk aplikacji i pokazuje **Recruitment Closed**. Przy 20 miejscach zajętych lub zarezerwowanych przycisk znika, a embed pokazuje **Clan Full · 20/20**. Zwolnienie miejsca przywraca przycisk, jeżeli nabór nie został ręcznie wyłączony.
- **Zamknięty ticket:** brak przycisków Reopen i Delete. Kanał pozostaje tylko do odczytu, z zapisanym powodem zamknięcia.
- **Boost:** podziękowanie po angielsku, z awatarem i kolorami GOAT, trafia do kanału `1558251766770962453`.
- **Rules:** rozbudowany angielski regulamin w trzech embedach trafia do kanału `1557875144855396353`. Bot odświeża tę samą wiadomość po restarcie.

Bot musi być online, żeby odświeżać panel i reagować na nowe zdarzenia.

## Wyjątek Support dla administracji

```text
/support-open user:@osoba reason:Follow-up on an earlier report
/support-open user:@osoba reason:Account issue username:RobloxUser
```

Komenda działa również przed 3 PM i po 10 PM. Nie otwiera rekrutacji i nie zużywa miejsc w klanie. Pomija cooldown osoby oraz jej limit godzinowy, ale zachowuje maksymalną kolejkę serwera, prywatność i zasadę jednej aktywnej rozmowy na osobę. Jeżeli osoba ma już otwartą aplikację albo Support, bot pokaże istniejący ticket. Powód i osoba otwierająca są zapisywane w tickecie oraz logu.

| Komenda administracyjna | Działanie |
| --- | --- |
| `/ticket reopen` | Ponownie otwiera zamknięty ticket w aktualnym kanale, również poza godzinami Support. |
| `/ticket reopen id:12` | Otwiera konkretny ticket z dowolnego kanału. |
| `/ticket delete confirm:True id:12` | Usuwa zamknięty kanał dopiero po dostarczeniu transkryptu do Ticket Logs. |
| `/rules-refresh` | Publikuje lub odświeża regulamin na ustawionym kanale. |
| `/boost-preview` | Pokazuje podziękowanie za boost wyłącznie Tobie. |
| `/ticket-panel` | Odświeża panel z bieżącymi godzinami i stanem klanu. |
| `/open-ticket count:5` | Otwiera nabór na pięć wolnych miejsc; aktywne aplikacje już rezerwują miejsca. |

Bot nie odczytuje liczby członków klanu z Roblox. Ustaw rzeczywistą liczbę wolnych miejsc przez `/open-ticket count:...`; potem rezerwacje i decyzje aktualizują licznik automatycznie.

## Jak uruchomić aktualizację

1. Rozpakuj **GOAT-Clan-Bot-Value-API-Community.zip**. W środku jest folder **GOAT-Clan-Bot**.
2. Dla istniejącego GitHub/Railway: w tym folderze uruchom **UPLOAD-GITHUB.ps1**. Używa całego rozpakowanego projektu. Szczegóły są w **UPDATE_V2_PL.md**.
3. Railway: **Deploy Latest Commit** z `main`, Root Directory `/R3V0-Discord-Bot-v2`. Zachowaj istniejący token i volume z bazą; ustawienia opisuje **RAILWAY_SETUP_PL.md**.
4. Lokalnie: skopiuj projekt do folderu bota, zachowując istniejący `.env` i katalog bazy, następnie uruchom **START-GOAT.bat**. Potrzebny jest Node.js 24.15 lub nowszy.
5. `/goat-status` ma pokazać **2.6.0**. Komendy, panel i regulamin aktualizują się automatycznie przy starcie.

Kanały, role, `/value` i kolorystyka są już skonfigurowane. Zmiana godzin: `tickets.supportHours.startHour` i `endHour` w `config.json`. Zmiana strefy: `timezone`. Możesz wyłączyć ograniczenie godzin przez `tickets.supportHours.enabled: false`. ID nowych kanałów są w `boosts.channelId` i `rules.channelId`.

## Ustawienia Discorda dla boostów

W **Server Settings → Overview → System Messages Channel** włącz powiadomienia o boostach i pozwól botowi widzieć kanał systemowy. Dzięki temu wykrywa też kolejne boosty osoby, która już boostuje. Gdy nie ma wiadomości systemowej, bot wykryje rozpoczęcie boostowania przez zmianę członka i wyśle podziękowanie po około 20 sekundach. Zdarzenia z obu źródeł są łączone, żeby uniknąć podwójnego podziękowania. Bot nie rozsyła zaległych podziękowań za stare boosty.

Włącz **Server Members Intent** oraz **Message Content Intent**. Na nowych kanałach bot potrzebuje **View Channel**, **Send Messages**, **Embed Links** i **Read Message History**; na kanale regulaminu także **Attach Files**, bo dołącza banner. Usunięty regulamin bot odtworzy. Nie zmienia ani nie usuwa wiadomości innych osób.

## Sprawdzenie kodu

```text
npm ci
npm test
npm run doctor
```

Testy używają lokalnych atrap Discord API. Rzeczywistego logowania na Twój serwer ani publikowania na GitHub nie wykonywano w trakcie przygotowywania ZIP-a.
