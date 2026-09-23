# R3V0 PS99 Whitelist Tracker v1.3.0

Bot Discord dla Pet Simulator 99 z monitoringiem wyłącznie whitelistowanych klanów.

## Tactical renderer 1.3.0

Projekt zawiera teraz renderer kart gracza zintegrowany bezpośrednio z komendami bota. Historia gracza przekazuje rzeczywisty `Roblox userId`, więc karta pobiera model dokładnie wyszukanej osoby. `/player info` generuje również pionową kartę gracza, a historia pokazuje realne TOP 3 członków aktualnego klanu.

Wymagany asset tła znajduje się w:

```text
assets/tactical/graffiti.png
```

`npm run build` kopiuje cały katalog `assets/` do `dist/assets`, a Dockerfile przenosi go również do obrazu produkcyjnego. Szczegóły scalenia: `INTEGRATION_REPORT.md`.

## Źródło prawdy

Dla monitorowanego klanu bot korzysta z oficjalnego:

```text
GET https://ps99.biggamesapi.io/api/clan/{clanName}
```

Aktualny battle jest pobierany bezpośrednio z mapy `Battles` zwracanej przez klan:

```ts
const activeBattle = clanData.Battles ? Object.values(clanData.Battles)[0] : null;
```

Punkty graczy pochodzą z:

```text
Battles[*].PointContributions
```

Diamenty graczy pochodzą z:

```text
DiamondContributions.AllTime.Data
```

Owner jest zawsze dopisywany do rosteru jako `PermissionLevel: 100`, nawet jeśli nie występuje w `Members[]`.

## Historia

Historia nie jest pobierana z BIG Games API. Scheduler sam zapisuje próbki do SQLite:

- `clan_history`
- `player_history`

Pierwszy snapshot jest wykonywany natychmiast po starcie bota. Kolejne próbki są wykonywane zgodnie z konfiguracją trackera.

Nowa komenda:

```text
/history
```

pokazuje ostatnie 24h głównego klanu.

```text
/history gracz:B3sttiee
```

pokazuje ostatnie 24h gracza znalezionego w whitelistowanym klanie.

Przy jednym snapshotcie delta wynosi `+0`, a wykres renderuje poziomą linię z informacją, że historia dopiero się zbiera.

## Najważniejsze komendy

```text
/whitelist add clan:R3V0
/whitelist remove clan:R3V0
/whitelist list
/whitelist refresh clan:R3V0

/clan info
/clan members
/clan history
/clan leaderboard

/player info player:B3sttiee
/player history player:B3sttiee
/player track player:B3sttiee clan:R3V0
/player tracked

/history
/history gracz:B3sttiee

/battle clan
/battle player player:B3sttiee

/game rap item:Huge Cat
/admin diagnostics
/bot status
```

## Railway

Persistent Volume:

```text
/app/data
```

Variable:

```env
DATABASE_PATH=/app/data/bot.db
```

Pełny zestaw zmiennych znajduje się w `RAILWAY_DEPLOY.md` oraz `.env.example`.
