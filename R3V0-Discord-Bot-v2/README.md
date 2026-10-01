# R3V0 • Discord Bot 2.0

Kompletny projekt Node.js / TypeScript z Discord.js, SQLite, Dockerem, Railway i CI dla GitHuba. Role oraz kanały podane w zamówieniu są już zapisane w `config/server.json`. Kod źródłowy i konfigurację wrzuć do głównego katalogu repozytorium; zachowaj pliki `.github`, `.gitignore` i `.dockerignore`.

## Co działa

- Moderacja, punktowe ostrzeżenia, ich historia, cofanie, wygaśnięcie i automatyczne timeouty.
- Publiczne odpowiedzi komend, czytelne embedy oraz prywatne komunikaty błędów. Dane weryfikacji i historia transakcji są prywatne.
- Logi wejść / wyjść z avatarem, wiadomości usuniętych i edytowanych; osobne logi zmian ról, kanałów, profilu, uprawnień i administracji.
- Weryfikacja własności Roblox kodem w opisie profilu, jedno powiązanie Roblox na użytkownika serwera i blokada równoczesnego użycia Roblox przez dwa Discordy.
- Pseudonim `Discord Display Name (@robloxusername)`: np. `Zerqon (@b3sttiee)`, nawet gdy login Discord to `zerqoon`.
- Nowe konta Discord: rola kwarantanny i natywny timeout na 3 dni. Powrót na serwer i restart zachowują pierwotny termin.
- Antyzaproszenia Discord z wykrywaniem maskowania, odstępów, Unicode, procentowego kodowania i linków w Markdown; kontrola także po edycji.
- GIF-y GIPHY z filtrem G oraz zatwierdzony katalog Tenor. Domyślnie brak potwierdzenia bezpieczeństwa oznacza usunięcie GIF-a bez punktów karnych.
- Trudne poziomy za pisanie i voice, role progowe, Booster ×1.5, 40 drogich boosterów XP i pięć rodzajów Canvas.
- Prywatny voice po wejściu na kanał tworzenia: nazwa, limit 1–99, blokowanie, ukrywanie, wyrzucanie, zapraszanie, przekazywanie oraz przejmowanie pokoju bez właściciela.
- `/setup-regulamin`: Twoja grafika R3V0 na dole embedu, przycisk akceptacji i link do weryfikacji.
- Transakcje ekonomii i zakupy są atomowe oraz odporne na ponowne dostarczenie interakcji. Logi mają kolejkę w SQLite z ponownym wysyłaniem.

## Pierwsze uruchomienie — GitHub → Railway

1. Rozpakuj ZIP. Wgraj **zawartość katalogu projektu** do repozytorium GitHub. Nie dodawaj `node_modules`, `dist`, bazy ani prawdziwego `.env`.
2. W [Discord Developer Portal](https://discord.com/developers/applications) utwórz lub wybierz bota. W sekcji Bot włącz **Server Members Intent** i **Message Content Intent**. Voice States jest zwykłym intentem używanym przez kod.
3. Zaproś bota z zakresami `bot` i `applications.commands`. Rola bota musi być nad Community, poziomami, kwarantanną oraz osobami, które ma moderować i którym ma zmieniać nick.
4. W Railway wybierz **Deploy from GitHub repo**. Projekt wykryje `Dockerfile` i ustawienia z `railway.json`.
5. Dodaj **Volume** z miejscem montowania **`/data`**. Ustaw **jedną replikę** usługi. SQLite i pokoje voice wymagają jednej aktywnej instancji bota.
6. Do Railway → Variables → Raw Editor wklej `RAILWAY-VARIABLES.env`. Uzupełnij trzy pola Discord oraz klucz GIPHY. Zapisz i uruchom deploy.
7. Po zalogowaniu komendy zostaną zarejestrowane automatycznie. Bot spróbuje przygotować ochronę, panel weryfikacji i instrukcję voice. Owner uruchamia **`/setup`**, następnie **`/setup-regulamin kanal:`** i **`/admin diagnostyka`**.

`DISCORD_CLIENT_ID` to Application ID bota. `DISCORD_GUILD_ID` to ID **serwera**, a nie ID którejś roli. Nie przesyłaj tokenu Discord ani kluczy API do repozytorium.

### Uprawnienia bota

View Channel, Send Messages, Read Message History, Embed Links, Attach Files, Manage Messages, View Audit Log, Manage Roles, Manage Channels, Manage Nicknames, Moderate Members, Kick Members, Ban Members, Connect oraz Move Members. Bot nie wymaga Administratora, ale potrzebuje tych praw w kanałach, które obsługuje.

W prywatnym voice uprawnienia zarządzania pokojem nadaje panel bota; właściciel pokoju nie dostaje przez panel Manage Channels ani Manage Roles.

## Variables — cały RAW

```dotenv
DISCORD_TOKEN=WPISZ_TOKEN_BOTA
DISCORD_CLIENT_ID=WPISZ_APPLICATION_ID_BOTA
DISCORD_GUILD_ID=WPISZ_ID_SERWERA
DATABASE_PATH=/data/community.sqlite
CONFIG_PATH=./config/server.json
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
AUTO_REGISTER_COMMANDS=true
GIPHY_API_KEY=
```

`GIPHY_API_KEY` włącza kontrolę i wyszukiwanie GIPHY. Bez niego automatyczne sprawdzanie GIPHY w trybie ścisłym jest niedostępne. Weryfikacja Roblox nie wymaga klucza Roblox, hasła, cookie `.ROBLOSECURITY` ani konta Bloxlink.

## Rola / kanał — konfiguracja

| Rola                         | ID                    |
| ---------------------------- | --------------------- |
| Owner                        | `1547346866927304704` |
| Moderator                    | `1547346876246786151` |
| Community — automatyczna     | `1547346877429719121` |
| Booster — XP ×1.5            | `1555034475447062548` |
| Kwarantanna — nowe konta     | `1555035240215351366` |
| Poziom 5 — Nowicjusz         | `1549339887361200170` |
| Poziom 10 — Dostęp do zdjęć  | `1549339888476758106` |
| Poziom 20 — Dostęp do GIF-ów | `1549339889248763914` |
| Poziom 30 — Weteran          | `1549339890259460096` |
| Poziom 50 — Legenda          | `1549339891131744297` |

| Kanał                            | ID                    |
| -------------------------------- | --------------------- |
| Awans / poziomy                  | `1554971115976138864` |
| Wiadomości, wejścia, wyjścia     | `1549346936484794379` |
| Zmiany i działania administracji | `1549346912723804191` |
| Wyłącznie komendy slash          | `1549346772931842169` |
| Przycisk weryfikacji Roblox      | `1549342942861459606` |
| Wejdź, aby utworzyć voice        | `1555036112148365393` |
| Kategoria prywatnych voice       | `1555036190527197226` |

## Weryfikacja Roblox

Panel jest w kanale `1549342942861459606`. Użytkownik klika przycisk, podaje **username Roblox**, otrzymuje prywatny losowy kod i umieszcza go w opisie własnego profilu Roblox. Sprawdzenie pobiera świeży profil przez publiczne API Roblox. Kod jest ważny 15 minut; kolejne sprawdzenie co najmniej co 5 sekund. Konto Roblox musi mieć 3 dni.

Bot używa pseudonimu serwerowego Discord, następnie globalnej nazwy wyświetlanej, a na końcu loginu, gdy nazw wyświetlanych nie ma. Nazwa Roblox w suffixie jest małymi literami. Pseudonim mieści się w 32 znakach; dla długiego username Roblox skraca się część Discord, zachowując pełne `(@roblox)`.

Własności nie potwierdza samo wpisanie username. Kod jest powiązany z Discord ID i Roblox ID; zastąpione i wygasłe wyzwania nie mogą zapisać połączenia. Po sukcesie kod można usunąć z Roblox. Powrót na serwer przywraca zapisany nick. `/weryfikacja odswiez` pobiera aktualny username i uwzględnia zmianę pseudonimu Discord.

To własny system weryfikacji w stylu Bloxlink z potwierdzeniem kodem na profilu. Nie jest usługą Bloxlink ani logowaniem OAuth. Discord nie pozwala botowi zmieniać nicku właściciela serwera lub osób powyżej roli bota; połączenie zostaje zapisane, a odpowiedź wyjaśnia, dlaczego nick czeka na synchronizację.

## Ostrzeżenia i kwarantanna

Domyślnie warn = 1 punkt; administracja może wybrać 1–5. Zaproszenie Discord = 2 punkty. Inny niedozwolony link = 1 punkt. Punkty obowiązują 30 dni. Automatyczne punkty dla tej samej osoby i kategorii są naliczane najwyżej raz na 60 sekund; kolejne naruszenia nadal są usuwane.

| Aktywne punkty | Automatyczny timeout |
| -------------: | -------------------: |
|              3 |             30 minut |
|              5 |             6 godzin |
|              7 |           24 godziny |

System nie skraca już dłuższego timeoutu. Cofnięcie ostrzeżenia zachowuje sprawę i powód cofnięcia; nie zdejmuje automatycznie timeoutu. Rozpatrz go przez `/moderacja untimeout`, jeżeli nie jest częścią kwarantanny. Progi i czas wygaśnięcia ustawisz w `moderation.warnings`.

Nowe konto Discord oznacza **wiek poniżej 72 godzin przy wejściu / sprawdzeniu przez bota**. Termin kwarantanny to pierwsze zapisane wejście + 72 godziny. Bot nadaje rolę `1555035240215351366`, usuwa Community i role poziomów, nadaje timeout i odłącza voice. Na kanałach ustawia ograniczenia roli; czytanie weryfikacji i opublikowanego regulaminu może pozostać dostępne. Natywny timeout blokuje komunikację także przy zezwoleniach innych zwykłych ról.

Podczas kwarantanny bot nie przyznaje XP, nie udostępnia ekonomii, weryfikacji ani pokoju voice. Discord może blokować także użycie przycisków w czasie timeoutu. Po zakończeniu bot oddaje Community i właściwe role poziomów; nie usuwa dłuższego timeoutu moderatora. Membership Screening musi być ukończony. Przegląd terminów odbywa się co minutę.

Owner może zakończyć kwarantannę wcześniej przez `/admin kwarantanna osoba: powod:`. Automatyczna ochrona pomija administrację i boty. Wiek konta oraz jedno połączenie Roblox ograniczają oczywiste multikonta; Discord nie udostępnia botowi IP ani dowodu, że starsze konta należą do jednej osoby.

## Antylink i GIF-y

**Aktualizacja usług (1 października 2026):** Google wyłączył publiczne API Tenor 30 czerwca 2026 i od stycznia nie wydaje nowych kluczy. Dlatego bot nie wykonuje zapytań do tego API. [Oficjalna informacja Google](https://support.google.com/tenor/answer/10455265?hl=en). Domyślna wyszukiwarka to GIPHY. Tenor pozostaje dostępny przez ręcznie zatwierdzony katalog.

Filtr obejmuje tworzenie i edycję wiadomości, zaproszenia `discord.gg`, `discord.com/invite`, `discordapp.com/invite`, maskowanie, katalogi serwerów oraz skracacze. Owner i Moderator mają wyjątek od filtra wiadomości. Zwykłe pisanie w kanale komend jest usuwane także administracji.

Domyślnie `strictExternalLinks=true`: dozwolone domeny to Roblox, YouTube, Wikipedia i GitHub oraz kontrolowane GIF-y. Własne domeny dopisz do `moderation.antiLink.allowedDomains`. Sprawdzanie dotyczy pełnej nazwy hosta: `roblox.com.evil.com` nie jest traktowane jak `roblox.com`. Bot nie otwiera dowolnych stron ani nie śledzi zewnętrznych przekierowań.

Zdjęcia wymagają roli poziomu 10, GIF-y roli poziomu 20. GIF-y z innych domen oraz samodzielnie przesyłane pliki GIF są ograniczone; publiczna domena nie daje informacji o klasyfikacji treści.

- **GIPHY:** API sprawdza dokładny ID i rating `g`.
- **Tenor:** Moderator ogląda materiał i zatwierdza jego dokładny ID przez `/moderacja gif-dopusc adres: powod:`. Wpis obowiązuje 30 dni. `/gif zrodlo:tenor` przeszukuje zatwierdzony katalog po opisie / powodzie. `/moderacja gif-zablokuj` cofa akceptację i blokuje ID, także jeżeli API GIPHY oznacza go jako G.
- Automatycznie dopuszczone wyniki GIPHY są zapisywane na 24 h w SQLite. Jeśli bezpośredni GIF nie przejdzie sprawdzenia, użytkownik wybiera inny przez `/gif`.
- Przy braku klucza, awarii API albo niepotwierdzonej klasyfikacji bot usuwa GIF z czytelną informacją **bez punktów karnych**.

Filtrowanie GIPHY korzysta z klasyfikacji dostawcy, a Tenor z ręcznej oceny administracji; nie analizuje obrazu własnym modelem NSFW i nie gwarantuje bezbłędnej klasyfikacji wszystkich materiałów. Tryb ścisły pozostaw włączony, jeżeli zależy Ci na blokowaniu niezweryfikowanych GIF-ów.

## XP, poziomy i ekonomia

Pisanie: **10–16 bazowego XP co 90 sekund**, co najmniej 15 liter / cyfr i 5 różnych znaków. Powtórki, spam samą literą, same linki i boty nie dają XP. Komendy, logi oraz kanał awansów nie naliczają tekstowego XP.

Voice: **4–8 bazowego XP co 60 sekund**, przy minimum **dwóch kwalifikujących się osobach**. Uczestnik musi być niewyciszony, nieogłuszony, poza AFK i kwarantanną. Boty nie liczą się do liczby osób. Zmiana pokoju, mute, utrata drugiego uczestnika oraz rozłączenie bota zerują rozpoczęty przedział. Bot liczy uczestnictwo w voice; nie nagrywa ani nie rozpoznaje faktycznej mowy. Czas offline nie jest odrabiany.

Wspólny limit: **1200 bazowego XP / dobę** w strefie Europe/Warsaw. Mnożnik nakłada się po limicie. Rola Booster daje **×1.5** na oba źródła; jeden kupiony booster może pomnożyć go do **×7.5**. Ułamki XP przenoszą się do następnej nagrody, więc ×1.5 nie traci połówek punktów.

`XP poziomu L = 120 × L² + 300 × L`. Role kumulują się od poziomów 5 / 10 / 20 / 30 / 50. Próg poziomu 50 to **315 000 XP** — przy samym podstawowym limicie co najmniej 263 aktywne dni. Maksymalny poziom: 100.

Praca: 70–120 Kryształów co godzinę. Daily: 250 + 25 za kolejny dzień serii, do 7 dni. Nagroda jest co 24 h; przerwa dłuższa niż 48 h resetuje serię. Przelew ma opłatę 3%, doliczaną do przekazywanej kwoty. Sklep sprzedaje wyłącznie XP, więc boostery nie zwiększają wypłat.

| Booster |    5M |   15M |    30M |     1H |     3H |     6H |     12H |     24H |
| ------- | ----: | ----: | -----: | -----: | -----: | -----: | ------: | ------: |
| ×1.5    |   250 |   600 |  1 000 |  1 800 |  4 500 |  9 000 |  17 000 |  32 000 |
| ×2      |   500 | 1 200 |  2 000 |  3 600 |  9 000 | 18 000 |  34 000 |  64 000 |
| ×3      | 1 000 | 2 400 |  4 000 |  7 200 | 18 000 | 36 000 |  68 000 | 128 000 |
| ×4      | 1 750 | 4 200 |  7 000 | 12 600 | 31 500 | 63 000 | 119 000 | 224 000 |
| ×5      | 2 750 | 6 600 | 11 000 | 19 800 | 49 500 | 99 000 | 187 000 | 352 000 |

Zakup dodaje produkt do ekwipunku; aktywacja odbywa się przez `/ekonomia uzyj`. Czas boostera biegnie od aktywacji także offline. Aktywnego boostera nie można zastąpić ani przedłużyć drugim zakupionym produktem; nieudana aktywacja nie zużywa przedmiotu.

`/profil` pokazuje rozbudowaną kartę z XP tekst / voice, czasem voice, połączeniem Roblox, mnożnikiem, poziomem, saldem i dziennym limitem. `/poziom` daje kompaktową kartę postępu. Jeżeli Canvas lub avatar są chwilowo niedostępne, komenda ma odpowiedź tekstową.

## Prywatny voice

Wejście na `1555036112148365393` tworzy pokój w kategorii `1555036190527197226`. Jedna osoba ma jeden pokój; kolejne wejście przenosi ją do istniejącego. Domyślny limit to 5 osób, panel pozwala ustawić 1–99. Maksymalnie 30 prywatnych pokoi i minutowy odstęp między tworzeniem nowych przez jedną osobę.

Panel znajduje się **w czacie kanału głosowego**. Kliknij ikonę czatu przy pokoju, aby go zobaczyć. `/voice panel` pokazuje go dodatkowo w kanale komend. Nazwa może mieć 2–100 znaków i zmienia się najwyżej co 5 minut z powodu limitów Discord.

Właściciel musi być na swoim pokoju, aby nim zarządzać. Administracja może zarządzać także z zewnątrz. Nie można blokować ani wyrzucać administracji, właściciela ani bota z tego panelu. Przekazanie wymaga, aby odbiorca był na pokoju i nie miał innego własnego pokoju. Przejęcie wymaga nieobecności właściciela i obecności przejmującego na kanale.

Zablokowanie wejścia i ukrycie zapisują poprzednie nadpisania; odblokowanie je przywraca. Zaproszenie tworzy dostęp dla konkretnej osoby, także do zamkniętego pokoju. Pusty pokój usuwa się po 15 s. Po restarcie bot odtwarza panele zapisanych, zajętych pokoi i usuwa puste; nie usuwa zwykłych voice spoza swojej bazy.

## Komendy

Pełna lista, argumenty i uprawnienia: **[KOMENDY.md](KOMENDY.md)**. Zwykli użytkownicy używają slash w kanale `1549346772931842169`. Owner i Moderator mogą używać komend na każdym dostępnym kanale. Przyciski weryfikacji i voice działają na swoich panelach. Pozytywne wyniki są publiczne, poza kodami Roblox, statusem połączenia, listą ostrzeżeń, historią moderacji i transakcji oraz szkicem ogłoszenia.

## Logi, dane i aktualizacja z v1

Role są opisane jako **Dodano role / Odebrano role**, z oznaczeniem i nazwą. W logach nie są publikowane `$add`, surowe obiekty JSON ani wrażliwe klucze audytu. Embedy kolejki są ograniczane do limitów Discord, w tym 6000 znaków.

Treść wiadomości jest zapisywana przez 7 dni / maksymalnie 50 000 wpisów. Dłuższe treści usunięte lub edytowane są dołączane jako TXT. Treści sprzed uruchomienia bota albo wyczyszczonej retencji mogą być niedostępne; log wyjaśnia brak cache. Kolejka logów przetrwa restart i ponawia wysyłanie po błędach dostępu lub API.

Baza SQLite w `/data/community.sqlite` zachowuje XP, salda, warny, wyzwania Roblox, kwarantannę, boostery, pokoje i kolejkę. Kopie są w `/data/backups`; automatycznie raz na dobę, ostatnie 7 kopii. `/admin backup` zapisuje spójną kopię w Volume.

Przy aktualizacji z v1 zachowaj ten sam Volume i `DATABASE_PATH`. Migracja robi spójną kopię `before-v2-*.sqlite`, przenosi XP, zachowuje salda i sprawy oraz **jednorazowo zwraca cenę niewykorzystanych produktów starego sklepu**. Stare tytuły i eliksiry są wycofane. Nie uruchamiaj równocześnie starej i nowej wersji bota.

## Lokalnie i testy

Node.js **24.17+ w ramach wersji 24**, npm oraz ewentualnie Python / make / g++, jeżeli SQLite będzie kompilowany lokalnie. Docker zawiera narzędzia potrzebne do instalacji natywnych pakietów.

```bash
npm ci
cp .env.example .env
npm run check
npm test
npm run build
npm start
```

Do lokalnego `.env` wpisz `DATABASE_PATH=./data/community.sqlite` i swoje dane Discord. `npm run dev` uruchamia tryb developerski. `npm run commands:deploy` wymusza rejestrację komend, `npm run preview` zapisuje podglądy PNG do `previews/`. Rejestracja w Railway odbywa się automatycznie po zmianie definicji.

Sprawdzono lokalnie kontrolę TypeScript, testy logiki oraz integracji z atrapami Discord / API i wizualne podglądy Canvas. Testy nie logują bota na prawdziwy serwer ani nie wdrażają Railway. Pierwszy deploy i hierarchię ról sprawdza `/admin diagnostyka`. `/health` zgłasza gotowość po połączeniu i inicjalizacji, `/health/live` dostępność procesu.

## Dokumentacja usług

- [Discord Developer Portal i dokumentacja](https://docs.discord.com/developers/intro)
- [Roblox Users API](https://create.roblox.com/docs/cloud/reference/features/users)
- [Tenor — zamknięcie API](https://support.google.com/tenor/answer/10455265?hl=en)
- [GIPHY API](https://developers.giphy.com/docs/api/endpoint/)
- [Railway Volumes](https://docs.railway.com/volumes)
