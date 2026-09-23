# R3V0 — Tactical Player Cards

Renderer inspirowany załączonym ekranem kart graczy: ciemnoszare tło, geometryczne linie, pionowa karta z ostrym dołem, graffiti, pełna postać Roblox, złote akcenty i turkusowa linia przy nicku. Na karcie historii boczne panele zawierają rzeczywiste dane przekazane przez bota, a poniżej jest wykres.

`PODGLAD-TACTICAL.png` i `KARTA-GRACZA.png` pokazują rzeczywisty avatar konta B3sttiee (displayName Zerqon), ale przykładowy klan, pozycję i statystyki. Dane demonstracyjne nie są wpisane do renderera.

## Instalacja

1. Podmień `src/canvas/renderers.ts`.
2. Skopiuj cały folder `assets/tactical/` do głównego katalogu bota. Ten folder musi też trafić na hosting lub do obrazu Dockera.
3. W istniejącym wywołaniu `renderHistory` przekazuj jako siódmy argument Roblox userId wyszukanej osoby.
4. Uruchom standardowy build projektu i zrestartuj bota.

Renderer korzysta z istniejącego `@napi-rs/canvas` oraz wbudowanego `fetch` (Node 20/22+). Nie wymaga dodatkowej biblioteki produkcyjnej. Potrzebny jest projekt ESM, tak jak w przesłanym kodzie z importami `.js`.

## Karta historii ze statystykami

Pierwszych siedem argumentów nie zmienia znaczenia:

```ts
const png = await renderHistory(
  player.displayName || player.name,
  `[${clanTag}] • ${battleName}`,
  stats,
  avatarUrl,
  selectedTimeframe,
  rivalry,
  Number(player.id), // ID Roblox WYSZUKANEJ osoby, nie ID Discord
);
```

Domyślny PNG ma 3200 × 2000 px. Wariant lżejszy: ósmy argument `{ scale: 1 }` daje 1600 × 1000 px.

`stats` i `rivalry` zachowują strukturę z przesłanego kodu. `selectedTimeframe`: `30m`, `1h`, `3h`, `6h`, `12h`, `24h`. Układ przedstawia current stars, gain, member rank, lead/gap, contribution, clan total, average/hour, best gain, current pace oraz wykres. Pozycja w klanie nie oznacza roli właściciela ani globalnej pozycji klanu.

Przed asynchronicznym renderowaniem komenda powinna już wywołać `deferReply`, a potem wysłać wynik przez swoje `editReply`. Nie wywołuj `deferReply` drugi raz, jeżeli już jest w komendzie. Nie otrzymano pliku komendy, więc jej wywołania nie zmieniano automatycznie.

## Sama pionowa karta gracza

Dodano osobny eksport `renderPlayerCard`, przydatny np. dla `/profile`:

```ts
import { AttachmentBuilder } from 'discord.js';
import { renderPlayerCard } from './canvas/renderers.js';

// Użyj już wyszukanego player. Nie wyszukuj konta po nieunikalnym displayName.
const png = await renderPlayerCard(
  player.displayName || player.name,
  `[${clanTag}] • ${battleName}`,
  avatarUrl,
  Number(player.id),
  {
    rank: rivalry?.rank,     // opcjonalna rzeczywista pozycja gracza w klanie
    // roleLabel: realRole,  // opcjonalny podpis dostarczony przez Twój kod
  },
);

// Po wcześniejszym deferReply w komendzie:
await interaction.editReply({
  files: [new AttachmentBuilder(png, { name: 'player-card.png' })],
});
```

Dostosuj ścieżkę importu do miejsca swojej komendy. `player`, `clanTag`, `battleName`, `avatarUrl` i `rivalry` oznaczają istniejące dane w Twojej komendzie, nie nowe globalne zmienne renderera.

Domyślna karta: 1040 × 1600 px. Przy `{ scale: 1 }`: 520 × 800 px. Bez `rank` na górze jest PROFILE. Podpis PLAYER PROFILE nie sugeruje, że gracz jest online lub gotowy do gry. Na karcie historii TRACKED oznacza, że przekazano historię pozwalającą policzyć przyrosty.

## Avatar i tło

Dla każdego userId pobierana jest oficjalna miniatura całej postaci Roblox 720 × 720, bez tła. Renderer przycina przezroczyste marginesy i zachowuje proporcje. Postać jest rysowana za przezroczystym paskiem nicku. To statyczny render postaci w PNG — poza i strój pochodzą z Roblox; nie jest to nowa animacja ani odtworzenie pozy człowieka ze wzorca.

Cache ma osobne wpisy dla każdego gracza i odświeża je po 5 minutach. Stan Pending, blokada lub błąd API uruchamia awaryjne użycie `avatarUrl`. Jeśli także ten obraz jest niedostępny, karta pokazuje AVATAR UNAVAILABLE. Pobranie metadanych i obrazu ma po 15 s limitu; pierwsze wywołanie może więc potrwać dłużej niż kolejne.

Bez siódmego argumentu `renderHistory` ID można odzyskać tylko z adresu Roblox zawierającego `userId` / `userIds`. Nie można odzyskać go z samego hasha adresu CDN. Renderer nie zgaduje ID z wyświetlanej nazwy.

`assets/tactical/graffiti.png` jest wyłącznie scenerią. Panele, wykres, ikony, napisy i model gracza nie są częścią tego obrazka. Przy braku tła działa prostsza wersja graffiti rysowana w Canvas. Do wyglądu widocznego w podglądzie potrzebny jest `assets/tactical/graffiti.png`; renderer ma bezpieczny fallback na systemowy font sans-serif.

## Ustawienia opcjonalne

Ósmy argument `renderHistory` i piąty `renderPlayerCard` obsługują:

```ts
{
  scale: 2,
  // assetDirectory: '/app/assets/tactical',
  // avatarRenderUrl: transparentFullBodyPngUrl,
  // heading: ['SPACE MINE', 'BATTLE 2026'],
}
```

`renderHistory` obsługuje także `leaderboard`: tablicę prawdziwych danych `{ rank, name, points }`, do trzech wpisów, pokazywanych nad wykresem. Nie dodaje fikcyjnych przeciwników. `now` jest opcjonalnym timestampem do powtarzalnych podglądów; produkcyjnie używane jest `Date.now()`.

Obsługa historii z poprzedniej wersji została zachowana: brak danych daje „—”, jeden pomiar nie tworzy fikcyjnego przyrostu, brak obserwacji przerywa linię wykresu, a reset punktów nie daje fałszywego zysku. Average/hour odnosi się do całego wybranego okna; best gain dotyczy przedziału wskazanego nad wykresem, pace przelicza ostatni przedział na godzinę. Oś czasu jest względna.

`renderRap` również ma spójne ciemne panele. Dotychczasowe eksporty pomocników zostały zachowane; nowy eksport to `renderPlayerCard`.

## Weryfikacja

- TypeScript 5.9.3, strict + noUncheckedIndexedAccess + NodeNext: bez błędów w stanowisku z kontraktami danych wynikającymi z przesłanego kodu.
- Rzeczywiste pobranie avatara B3sttiee oraz render dashboardu i pionowej karty.
- Podglądy braku danych, długiego nicku i wyceny RAP.
- Test różnych userId, osobnego cache, Pending API, braku plików assets i wymiarów obrazów.
- Zachowane 20 istniejących eksportów funkcji.

Nie otrzymano pełnego projektu bota, więc nie wykonano jego pełnego builda ani testu slash-komendy na Discordzie.

## Grafika i fonty

Graffiti przygotowano wbudowanym ImageGen na podstawie załączonej referencji, bez postaci i tekstów. Pełny prompt: `BACKGROUND-PROMPT.txt`. Tło projektu: `assets/tactical/graffiti.png`.

W paczce scalonego projektu renderer korzysta z systemowego fallbacku sans-serif/DejaVu. Dockerfile instaluje `fonts-dejavu-core`, więc dodatkowe pliki fontów nie są wymagane do uruchomienia bota.
- Dokumentacja miniatur Roblox: https://thumbnails.roblox.com/docs/json/v1
