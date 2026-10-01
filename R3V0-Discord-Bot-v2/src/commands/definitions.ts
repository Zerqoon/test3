import {
  SlashCommandBuilder,
  ChannelType,
  type SlashCommandUserOption,
  type SlashCommandStringOption,
} from "discord.js";
import { config } from "../config.js";

const command = (name: string, description: string) =>
  new SlashCommandBuilder().setName(name).setDescription(description);
const target = (option: SlashCommandUserOption) =>
  option
    .setName("osoba")
    .setDescription("Użytkownik serwera")
    .setRequired(true);
const reason = (option: SlashCommandStringOption) =>
  option
    .setName("powod")
    .setDescription("Powód działania")
    .setRequired(true)
    .setMaxLength(400);

export const commandBuilders = [
  command("ping", "Sprawdź opóźnienie i dostępność bota"),
  command("pomoc", "Lista funkcji, komend i zasad korzystania z bota"),
  command("regulamin", "Wyświetl aktualny regulamin serwera"),
  command("poziom", "Karta poziomu i postępu do kolejnej rangi").addUserOption(
    (o) => o.setName("osoba").setDescription("Opcjonalnie inna osoba"),
  ),
  command(
    "profil",
    "Elegancka karta aktywności, tytułu i ekonomii",
  ).addUserOption((o) =>
    o.setName("osoba").setDescription("Opcjonalnie inna osoba"),
  ),
  command("ranking", "Top 10 aktywności lub ekonomii").addStringOption((o) =>
    o
      .setName("typ")
      .setDescription("Rodzaj rankingu")
      .setRequired(true)
      .addChoices(
        { name: "Poziomy / XP", value: "xp" },
        { name: "Ekonomia", value: "balance" },
      ),
  ),
  command("info", "Informacje o serwerze, osobie lub bocie")
    .addSubcommand((s) =>
      s.setName("serwer").setDescription("Statystyki i informacje serwera"),
    )
    .addSubcommand((s) =>
      s
        .setName("osoba")
        .setDescription("Profil Discord użytkownika")
        .addUserOption(target),
    )
    .addSubcommand((s) =>
      s.setName("bot").setDescription("Status i działające moduły bota"),
    ),
  command("ekonomia", "Portfel, zarabianie, przelewy i sklep")
    .addSubcommand((s) =>
      s
        .setName("saldo")
        .setDescription("Portfel i ranking ekonomii")
        .addUserOption((o) =>
          o.setName("osoba").setDescription("Opcjonalnie inna osoba"),
        ),
    )
    .addSubcommand((s) =>
      s.setName("praca").setDescription("Pracuj i odbierz wypłatę"),
    )
    .addSubcommand((s) =>
      s
        .setName("daily")
        .setDescription("Odbierz nagrodę co 24 godziny i utrzymaj serię"),
    )
    .addSubcommand((s) =>
      s
        .setName("przelew")
        .setDescription("Przekaż walutę innej osobie")
        .addUserOption(target)
        .addIntegerOption((o) =>
          o
            .setName("kwota")
            .setDescription("Kwota dla odbiorcy; opłata doliczana oddzielnie")
            .setMinValue(1)
            .setMaxValue(1e8)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("sklep")
        .setDescription("Drogie boostery XP za tekst i voice")
        .addIntegerOption((o) =>
          o
            .setName("strona")
            .setDescription("Strona 1–5, po jednym mnożniku")
            .setMinValue(1)
            .setMaxValue(5),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("kup")
        .setDescription("Kup produkt za walutę")
        .addStringOption((o) =>
          o
            .setName("produkt")
            .setDescription("Produkt ze sklepu")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("ekwipunek").setDescription("Sprawdź zakupione boostery XP"),
    )
    .addSubcommand((s) =>
      s
        .setName("uzyj")
        .setDescription("Aktywuj jeden booster XP z ekwipunku")
        .addStringOption((o) =>
          o
            .setName("produkt")
            .setDescription("Produkt z ekwipunku")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("historia")
        .setDescription("Ostatnie 10 transakcji Twojego konta"),
    ),
  command("moderacja", "Narzędzia moderacji — Moderator i Owner")
    .addSubcommand((s) =>
      s
        .setName("gif-dopusc")
        .setDescription("Zatwierdź ręcznie sprawdzony GIF Tenor na 30 dni")
        .addStringOption((o) =>
          o
            .setName("adres")
            .setDescription("Link HTTPS do konkretnego GIF-a Tenor")
            .setRequired(true)
            .setMaxLength(500),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("gif-zablokuj")
        .setDescription("Zablokuj konkretny GIF Tenor lub GIPHY")
        .addStringOption((o) =>
          o
            .setName("adres")
            .setDescription("Link do konkretnego GIF-a")
            .setRequired(true)
            .setMaxLength(500),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("warn")
        .setDescription("Zapisz punktowe ostrzeżenie i sprawdź progi")
        .addUserOption(target)
        .addStringOption(reason)
        .addIntegerOption((o) =>
          o
            .setName("punkty")
            .setDescription("Punkty ostrzeżenia; domyślnie 1")
            .setMinValue(1)
            .setMaxValue(5),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("sprawy")
        .setDescription("Pokaż historię moderacji osoby")
        .addUserOption(target),
    )
    .addSubcommand((s) =>
      s
        .setName("unwarn")
        .setDescription("Cofnij konkretne ostrzeżenie")
        .addIntegerOption((o) =>
          o
            .setName("id")
            .setDescription("Numer sprawy")
            .setMinValue(1)
            .setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("timeout")
        .setDescription("Wycisz osobę na wskazany czas")
        .addUserOption(target)
        .addIntegerOption((o) =>
          o
            .setName("minuty")
            .setDescription("Czas w minutach")
            .setMinValue(1)
            .setMaxValue(config.moderation.maxTimeoutMinutes)
            .setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("untimeout")
        .setDescription("Zdejmij wyciszenie")
        .addUserOption(target)
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("kick")
        .setDescription("Wyrzuć osobę z serwera")
        .addUserOption(target)
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("ban")
        .setDescription("Zbanuj członka serwera")
        .addUserOption(target)
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("unban")
        .setDescription("Zdejmij bana po ID użytkownika")
        .addStringOption((o) =>
          o
            .setName("id")
            .setDescription("ID użytkownika Discord")
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(20),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("clear")
        .setDescription("Usuń do 100 wiadomości młodszych niż 14 dni")
        .addIntegerOption((o) =>
          o
            .setName("ilosc")
            .setDescription("Liczba wiadomości")
            .setMinValue(1)
            .setMaxValue(config.moderation.maxPurge)
            .setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("nick")
        .setDescription("Zmień pseudonim osoby")
        .addUserOption(target)
        .addStringOption((o) =>
          o
            .setName("nazwa")
            .setDescription("Nowy pseudonim")
            .setMaxLength(32)
            .setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("rola")
        .setDescription("Dodaj lub usuń zwykłą rolę")
        .addUserOption(target)
        .addRoleOption((o) =>
          o.setName("rola").setDescription("Rola").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("akcja")
            .setDescription("Co zrobić?")
            .setRequired(true)
            .addChoices(
              { name: "Dodaj", value: "add" },
              { name: "Usuń", value: "remove" },
            ),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("slowmode")
        .setDescription("Ustaw tryb powolny na bieżącym kanale")
        .addIntegerOption((o) =>
          o
            .setName("sekundy")
            .setDescription("0 wyłącza slowmode")
            .setMinValue(0)
            .setMaxValue(21600)
            .setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("lock")
        .setDescription("Zablokuj pisanie dla @everyone i Community")
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("unlock")
        .setDescription("Przywróć nadpisania zapisane przed /lock")
        .addStringOption(reason),
    ),
  command("admin", "Konfiguracja i zarządzanie — tylko Owner")
    .addSubcommand((s) =>
      s
        .setName("kwarantanna")
        .setDescription("Owner: zwolnij osobę z kwarantanny z podaniem powodu")
        .addUserOption(target)
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("diagnostyka")
        .setDescription("Sprawdź role, kanały, uprawnienia i kolejkę logów"),
    )
    .addSubcommand((s) =>
      s
        .setName("publikuj")
        .setDescription("Opublikuj gotowy panel")
        .addStringOption((o) =>
          o
            .setName("panel")
            .setDescription("Rodzaj panelu")
            .setRequired(true)
            .addChoices(
              { name: "Regulamin", value: "rules" },
              { name: "Informacje", value: "info" },
              { name: "Poziomy i ekonomia", value: "guide" },
            ),
        )
        .addChannelOption((o) =>
          o
            .setName("kanal")
            .setDescription("Domyślnie bieżący kanał")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("synchronizacja")
        .setDescription(
          "Nadaj Community i wyrównaj role poziomów istniejących członków",
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("poziom")
        .setDescription("Ustaw poziom i zsynchronizuj role osoby")
        .addUserOption(target)
        .addIntegerOption((o) =>
          o
            .setName("wartosc")
            .setDescription("Docelowy poziom")
            .setMinValue(0)
            .setMaxValue(config.leveling.maxLevel)
            .setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("waluta")
        .setDescription("Dodaj lub odejmij walutę z wpisem w historii")
        .addUserOption(target)
        .addIntegerOption((o) =>
          o
            .setName("zmiana")
            .setDescription("Liczba dodatnia lub ujemna")
            .setMinValue(-1e8)
            .setMaxValue(1e8)
            .setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName("backup")
        .setDescription("Zapisz spójną kopię SQLite w katalogu danych"),
    ),
  command("setup", "Owner: ochrona nowych kont, weryfikacja i voice"),
  command(
    "setup-regulamin",
    "Owner: piękny regulamin z banerem i akceptacją",
  ).addChannelOption((o) =>
    o
      .setName("kanal")
      .setDescription("Kanał regulaminu; domyślnie bieżący")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  ),
  command(
    "setup-weryfikacja",
    "Owner: utwórz lub odśwież panel weryfikacji Roblox",
  ),
  command("setup-voice", "Owner: skonfiguruj prywatne pokoje voice"),
  command("weryfikacja", "Połącz własne konto Roblox z Discordem")
    .addSubcommand((s) =>
      s
        .setName("polacz")
        .setDescription("Otrzymaj kod potwierdzenia własności")
        .addStringOption((o) =>
          o
            .setName("roblox")
            .setDescription("Nazwa użytkownika Roblox, bez @")
            .setRequired(true)
            .setMaxLength(20),
        ),
    )
    .addSubcommand((s) =>
      s.setName("sprawdz").setDescription("Sprawdź kod w swoim opisie Roblox"),
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("Sprawdź swoje połączenie Roblox"),
    )
    .addSubcommand((s) =>
      s
        .setName("odswiez")
        .setDescription("Odśwież nazwę Roblox i pseudonim Discord"),
    ),
  command("ostrzezenia", "Punkty, historia i zarządzanie ostrzeżeniami")
    .addSubcommand((s) =>
      s
        .setName("lista")
        .setDescription(
          "Twoje ostrzeżenia; administracja może wybrać inną osobę",
        )
        .addUserOption((o) =>
          o.setName("osoba").setDescription("Osoba; domyślnie Ty"),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("dodaj")
        .setDescription("Moderator: dodaj ostrzeżenie")
        .addUserOption(target)
        .addStringOption(reason)
        .addIntegerOption((o) =>
          o
            .setName("punkty")
            .setDescription("Domyślnie 1 punkt")
            .setMinValue(1)
            .setMaxValue(5),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("usun")
        .setDescription("Moderator: cofnij ostrzeżenie")
        .addIntegerOption((o) =>
          o
            .setName("id")
            .setDescription("ID sprawy")
            .setMinValue(1)
            .setRequired(true),
        )
        .addStringOption(reason),
    ),
  command("voice", "Zarządzanie własnym pokojem voice").addSubcommand((s) =>
    s.setName("panel").setDescription("Pokaż panel swojego pokoju na czacie"),
  ),
  command("gif", "GIF-y: GIPHY G lub zatwierdzony katalog Tenor")
    .addStringOption((o) =>
      o
        .setName("szukaj")
        .setDescription("Co chcesz znaleźć?")
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(80),
    )
    .addStringOption((o) =>
      o
        .setName("zrodlo")
        .setDescription("Domyślnie GIPHY")
        .addChoices(
          { name: "Tenor — zatwierdzony katalog", value: "tenor" },
          { name: "GIPHY", value: "giphy" },
        ),
    ),
  command(
    "ogloszenie",
    "Utwórz ogłoszenie z formularza — Moderator i Owner",
  ).addChannelOption((o) =>
    o
      .setName("kanal")
      .setDescription("Kanał publikacji; domyślnie bieżący")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  ),
];
export const commandData = commandBuilders.map((c) => c.toJSON());
