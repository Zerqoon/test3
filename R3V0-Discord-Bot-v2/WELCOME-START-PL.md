# Nowy Welcome GOAT

Canvas powitania ma rozdzielczość 1920 x 1080, turkus GOAT, biel i miętowe
akcenty. Zachowano oryginalne grafiki petów. Avatar jest większy i kadrowany
do koła bez rozciągania. Nick automatycznie dopasowuje się do dostępnej szerokości.
Dołączony font Noto Emoji obsługuje emoji w nickach bez dodatkowych pobrań.
Licznik pokazuje rzeczywistą liczbę członków serwera. Brak avatara lub błąd
pobrania uruchamia avatar zastępczy z monogramem G.

Wgraj pełną paczkę bota przez **FIX-GOAT-INSTALL-API.ps1** z poprzedniej wiadomości,
a następnie wdroż nowy commit na Railway. Paczka
**GOAT-Clan-Bot-Value-API-Welcome.zip** pasuje do tego skryptu, również z numerem pobrania.
Pozostaw istniejące zmienne Railway i wolumen /app/data.

Po wdrożeniu wpisz **/welcome-preview** na Discordzie: komenda użyje Twojego
aktualnego avatara, nicku i liczby członków. Ten sam renderer obsługuje powitania
nowych osób. Gotowy podgląd jest w **docs/goat-welcome-preview.png**; lokalnie
wygenerujesz go przez **npm run build**, następnie **npm run preview**.

W paczce nadal jest /value, jego API, tickety i pozostałe funkcje bota.
