# Uruchomienie bota

Wszystkie podane role i kanały są już wpisane w `config/server.json`.

1. Rozpakuj ZIP. Wejdź do folderu `community-guard`.
2. Utwórz aplikację na https://discord.com/developers/applications i dodaj bota.
3. W **Bot → Privileged Gateway Intents** włącz **Server Members Intent** i **Message Content Intent**.
4. W **OAuth2 → URL Generator** zaznacz `bot` i `applications.commands`. Uprawnienia i hierarchia są opisane w `README.md`.
5. Zaproś bota. Ustaw jego rolę **pod Moderatorem, ale nad Community i wszystkimi rolami poziomów**.
6. Wyślij zawartość folderu na GitHub. W głównym katalogu repo mają być `package.json`, `Dockerfile`, `railway.json`, `src/`, `config/`, `assets/`. Nie wysyłaj samego ZIP-a.
7. W Railway wybierz **New Project → Deploy from GitHub repo**, następnie to repozytorium.
8. W **Variables** dodaj:

```dotenv
DISCORD_TOKEN=token_bota
DISCORD_CLIENT_ID=application_id
DISCORD_GUILD_ID=id_twojego_serwera
DATABASE_PATH=/data/community.sqlite
AUTO_REGISTER_COMMANDS=true
NODE_ENV=production
```

9. Dodaj **Volume** podłączony do usługi bota. **Mount Path: `/data`**. Po dodaniu Volume wykonaj deploy. Pozostaw **1 replikę**, wyłącz **Serverless/App Sleeping** i nie ustawiaj harmonogramu Cron.
10. Poczekaj na wpis **Bot gotowy** w Railway Logs.
11. Jako Owner wpisz `/admin diagnostyka`. Jeśli konfiguracja jest poprawna, użyj `/admin synchronizacja`, aby nadać Community obecnym użytkownikom i wyrównać role poziomów.
12. Opublikuj regulamin i informacje przez `/admin publikuj`, wybierając panel oraz kanał. Własny tekst regulaminu, informacje i nazwę bota zmieniasz w `config/server.json` i wysyłasz zmianę na GitHub.

Token wklejaj tylko do Railway Variables lub lokalnego `.env`. ID aplikacji znajdziesz w Developer Portal → General Information → Application ID. ID serwera: Discord → Ustawienia → Zaawansowane → Tryb dewelopera → prawy przycisk na serwerze → Kopiuj ID serwera.

Pełna instrukcja, wszystkie komendy i konfiguracja uprawnień: `README.md`.
