# R3V0 v1.2.0 — critical data rewrite

## Naprawione

- `Battles` jest parsowane jako dynamiczna mapa battle ID -> BattleData.
- Aktualny battle dla monitorowanego klanu pochodzi z pierwszej wartości `Object.values(Battles)`.
- Punkty graczy pochodzą z `PointContributions`, nie ze starego modelu contribution.
- Owner jest dopisywany do rosteru z `PermissionLevel=100`, nawet gdy nie występuje w `Members`.
- `DiamondContributions.AllTime.Data` jest mapowane per UserID.
- Dodane `clan_history` i `player_history` z indeksami.
- Scheduler zapisuje snapshot klanu i każdego członka natychmiast po starcie oraz w kolejnych cyklach.
- `/history` renderuje realny wykres 24h z SQLite.
- Jeden snapshot daje deltę `+0` i prawidłowy poziomy wykres.
- Brak battle daje punkty `0` i czytelny status zamiast błędnego placeholdera.
- Migrator uruchamia wszystkie pliki SQL po kolei i zapisuje `schema_migrations`.
- Nie są używane nieistniejące endpointy `/api/player` ani `/api/user`.
