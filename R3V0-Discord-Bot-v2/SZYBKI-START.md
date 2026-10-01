# R3V0 v2 — szybkie wdrożenie

1. Rozpakuj ZIP i wrzuć zawartość katalogu projektu do głównego katalogu repozytorium GitHub.
2. Developer Portal → Bot: włącz Server Members Intent i Message Content Intent. Zaproś z bot + applications.commands.
3. Rola bota nad Community, poziomami, kwarantanną i osobami do moderacji / zmiany nicku. Bot potrzebuje także Manage Channels, Manage Roles, Moderate Members, Move Members, View Audit Log, Send Messages, Embed Links i Attach Files.
4. Railway → Deploy from GitHub repo → dodaj **Volume `/data`** → **jedna replika**.
5. Railway Variables → Raw Editor: wklej **RAILWAY-VARIABLES.env**. Uzupełnij token, Application ID, ID serwera oraz klucz GIPHY dla ścisłego filtrowania GIF-ów.
6. Deploy → Owner: **/setup**, **/setup-regulamin kanal:**, **/admin diagnostyka**.

API Tenor zostało wyłączone przez Google. Bot używa GIPHY G oraz ręcznie zatwierdzonego katalogu Tenor (/moderacja gif-dopusc).

Wszystkie przekazane ID ról i kanałów są już w `config/server.json`. Roblox potwierdza się kodem w opisie profilu; nie wymaga klucza Roblox.

Nowe konta Discord (<72 h) czekają 3 dni; termin nie resetuje się po wyjściu. Booster roli ×1.5 i sklepowe ×1.5–×5 dotyczą pisania oraz voice. Sklep ma tylko 40 boosterów XP. Panel prywatnego voice jest w czacie utworzonego pokoju.

Aktualizacja v1: zachowaj Volume i ten sam plik SQLite. Bot zrobi kopię bazy i migrację bez resetowania XP, sald ani spraw.

Pełne instrukcje: README.md. Pełny spis komend: KOMENDY.md.
