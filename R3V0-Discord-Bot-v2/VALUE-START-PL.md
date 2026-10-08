# /value — Pet Universe w Twoim bocie GOAT

Do przesłanego bota dodano komendę `/value`. Dotychczasowe tickety, rekrutacja,
blacklisty, GIF-y, logi, role, giveaways i statystyki pozostają w projekcie.
Token bota, serwer, role i kanały zachowują dotychczasową konfigurację.

## Aktualizacja

1. Najpierw wgraj paczkę strony z API i poczekaj na ukończenie jej wdrożenia.
   Otwórz `https://petuniverse-values.pl/api/v1/values.json` i sprawdź `ok: true`.
2. Wgraj projekt bota przez dotychczasowy workflow i zrestartuj go. Pozostaw
   istniejące Railway Variables oraz wolumen `/app/data`.
3. Domyślna domena jest już wpisana. Dla innej strony ustaw w Railway Variables:

```text
VALUE_SITE_URL=https://twoja-domena.pl
```

Bot wymaga Node.js co najmniej 24.15.0 jak dotychczas. Lokalnie użyj istniejącego
`.env`, a następnie `npm ci`, `npm run build` i `npm start`. Gotowe `dist/` jest
również dołączone. Nie dodano nowych zależności npm.

`autoRegisterCommands` zachowuje dotychczasowe ustawienie. Gdy jest włączone,
restart zarejestruje listę 41 komend wraz z `/value`. Przy ręcznej rejestracji
uruchom `npm run register` z istniejącymi DISCORD_TOKEN, APPLICATION_ID i GUILD_ID.
Rejestracja zawiera wszystkie dotychczasowe komendy.

## Użycie

```text
/value name:Gummy Bear
/value name:Sunken Eel variant:Golden
/value name:Ruby Majesty variant:Diamond
/value name:Secret Charm category:Charms
/value name:Party Egg category:Eggs
/value name:1M Lucky Block category:Items
```

Zacznij wpisywać nazwę i wybierz podpowiedź. Domyślne ustawienia to Pets i Normal.
Pole name przyjmuje też pełną nazwę lub ID z katalogu. Komenda jest publiczna:
każdy członek serwera może sprawdzić wartość, a embed pojawia się na kanale.
Wymagane uprawnienia kanału obejmują View Channel, Send Messages i Embed Links.

Embed pokazuje cenę w ticketach, właściwą grafikę wariantu, rarity, wariant,
kategorię, źródło i opcjonalne procenty, event, mapę, hatch chance oraz exists.
Stopka i czas dotyczą aktualizacji listy wartości. Brak daty pozostaje oznaczony.
O/C i Not Price nie są liczbą zero. Jeśli pet nie ma Golden/Diamond, bot podaje
czytelny komunikat. Nie wyszukuje przypadkowego peta na podstawie skrótu nazwy.

## Dane i dostępność

Bot czyta `/api/v1/values`; przy wyłączonych Pages Functions automatycznie używa
`/api/v1/values.json`. Publiczne API odczytu nie potrzebuje klucza ani tokenu admina.
Każde wykonanie komendy sprawdza aktualną odpowiedź. Podpowiedzi używają cache
30 sekund, współdzielą równoczesne pobrania i mają krótki limit oczekiwania.
Przy awarii API bot pokazuje komunikat, zamiast prezentować starą cenę jako nową.

Nowy blok `values` w config.json ustawia domenę, czas cache oraz enabled.
Możesz wyłączyć funkcję przez `values.enabled: false`. Zmienna VALUE_SITE_URL
ma pierwszeństwo przed `values.siteUrl`. Ceny edytujesz nadal po stronie strony.

Jeżeli `/value` nie jest widoczne, sprawdź rejestrację i zaproszenie bota z
applications.commands. Jeżeli API jest niedostępne, najpierw sprawdź JSON pod
domeną strony i zakończenie wdrożenia. Wymagana jest paczka strony z dodanym API.

`npm test`: 202 testy, w tym 16 nowych scenariuszy lookupu, embeda, podpowiedzi,
odświeżenia cen, błędów, wariantów i publicznych uprawnień. Weryfikowano prawdziwe
moduły discord.js i lokalne HTTP. Testy nie logują bota do Discorda ani nie
wysyłają wiadomości. Wdrożenie na Twoim koncie pozostaje do uruchomienia przez Ciebie.
