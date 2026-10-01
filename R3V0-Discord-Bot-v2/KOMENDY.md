# R3V0 v2 — pełny spis komend

Zwykli użytkownicy: kanał **1549346772931842169**. Owner **1547346866927304704** i Moderator **1547346876246786151** mogą używać komend na każdym dostępnym kanale. Przyciski voice i weryfikacji działają na swoich panelach. Konta w kwarantannie czekają na zakończenie ochrony.

`[argument]` jest opcjonalny. Argumenty bez nawiasów są wymagane. Bot ma **19 głównych komend slash**.

## Społeczność

| Komenda                | Działanie                                                     |
| ---------------------- | ------------------------------------------------------------- |
| `/pomoc`               | Publiczne centrum pomocy                                      |
| `/ping`                | Opóźnienie Gateway i obsługi komendy                          |
| `/regulamin`           | Zasady z banerem i przyciskiem akceptacji                     |
| `/info serwer`         | Informacje o serwerze i boostach                              |
| `/info osoba osoba:`   | Konto Discord, avatar, role i poziom                          |
| `/info bot`            | Czas pracy, wersja i moduły                                   |
| `/poziom [osoba:]`     | Kompaktowy Canvas postępu                                     |
| `/profil [osoba:]`     | Rozbudowany Canvas: Roblox, tekst / voice XP, mnożnik i saldo |
| `/ranking typ:xp`      | TOP 10 XP obecnych członków                                   |
| `/ranking typ:balance` | TOP 10 sald obecnych członków                                 |

## Ekonomia

| Komenda                           | Działanie                                              |
| --------------------------------- | ------------------------------------------------------ |
| `/ekonomia saldo [osoba:]`        | Publiczny portfel Canvas                               |
| `/ekonomia praca`                 | Wypłata 70–120 Kryształów co godzinę                   |
| `/ekonomia daily`                 | Nagroda co 24 h i seria do 7 dni                       |
| `/ekonomia przelew osoba: kwota:` | Przelew; opłata 3% dodatkowo od nadawcy                |
| `/ekonomia sklep [strona:]`       | Sklep boosterów XP, strony 1–5                         |
| `/ekonomia kup produkt:`          | Kup booster do ekwipunku; wybór przez autouzupełnianie |
| `/ekonomia ekwipunek`             | Twoje przedmioty i aktywny booster                     |
| `/ekonomia uzyj produkt:`         | Aktywuj posiadany booster; maksymalnie jeden naraz     |
| `/ekonomia historia`              | Prywatne ostatnie 10 transakcji                        |

Przykład: `/ekonomia kup produkt:xp-2-60`, potem `/ekonomia uzyj produkt:xp-2-60` → ×2 XP przez 1 h. Identyfikatory produktów mają format `xp-MNOZNIK-MINUTY`, np. `xp-1_5-15`, `xp-5-1440`. Wyszukaj mnożnik `x5` lub czas `24H` w autouzupełnianiu.

Sklep: ×1.5 / ×2 / ×3 / ×4 / ×5 na 5M / 15M / 30M / 1H / 3H / 6H / 12H / 24H. Role Booster ×1.5 i zakupiony booster mnożą się — maksymalnie ×7.5. Oba źródła XP korzystają z boostera.

## Roblox

| Komenda / przycisk                                | Działanie                                         |
| ------------------------------------------------- | ------------------------------------------------- |
| **Zweryfikuj konto** w kanale 1549342942861459606 | Formularz username i prywatny kod do opisu Roblox |
| **Sprawdź kod**                                   | Potwierdzenie własności Roblox i zapis pseudonimu |
| **Moje połączenie**                               | Prywatny status                                   |
| `/weryfikacja polacz roblox:`                     | Wygeneruj kod własności                           |
| `/weryfikacja sprawdz`                            | Sprawdź aktywny kod w opisie                      |
| `/weryfikacja status`                             | Twoje połączenie                                  |
| `/weryfikacja odswiez`                            | Odśwież username Roblox i pseudonim Discord       |

Nick: **Zerqon (@b3sttiee)** — pierwsza część to pseudonim / nazwa wyświetlana Discord. Weryfikacja i status są prywatne. Nie podajesz hasła ani cookies Roblox.

## Ostrzeżenia

| Komenda                                      | Dostęp / działanie                                        |
| -------------------------------------------- | --------------------------------------------------------- |
| `/ostrzezenia lista [osoba:]`                | Własna lista prywatna; inna osoba tylko dla administracji |
| `/ostrzezenia dodaj osoba: powod: [punkty:]` | Moderator / Owner: 1–5 punktów, domyślnie 1               |
| `/ostrzezenia usun id: powod:`               | Moderator / Owner: cofnij warn z zachowaniem historii     |
| `/moderacja warn osoba: powod: [punkty:]`    | Ten sam punktowy system                                   |
| `/moderacja sprawy osoba:`                   | Prywatna historia wszystkich rodzajów spraw               |
| `/moderacja unwarn id: powod:`               | Cofnij konkretne ostrzeżenie                              |

3 / 5 / 7 aktywnych punktów → timeout 30 min / 6 h / 24 h. Ostrzeżenia wygasają po 30 dniach. Wynik dodania / cofnięcia jest publiczny. Cofnięcie nie usuwa historii ani automatycznie nie zdejmuje timeoutu.

## Moderacja — Moderator / Owner

| Komenda                                                | Działanie                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `/moderacja timeout osoba: minuty: powod:`             | Timeout 1–40320 minut                                                     |
| `/moderacja untimeout osoba: powod:`                   | Zdejmij zwykły timeout; kwarantannę kończy Owner                          |
| `/moderacja kick osoba: powod:`                        | Wyrzuć członka                                                            |
| `/moderacja ban osoba: powod:`                         | Zbanuj członka                                                            |
| `/moderacja unban id: powod:`                          | Zdejmij bana po Discord ID                                                |
| `/moderacja clear ilosc: powod:`                       | Usuń 1–100 wiadomości, pomiń te starsze niż 14 dni i odpowiedź komendy    |
| `/moderacja nick osoba: nazwa: powod:`                 | Zmień pseudonim, do 32 znaków                                             |
| `/moderacja rola osoba: rola: akcja:add/remove powod:` | Zarządzaj zwykłą, dozwoloną rolą                                          |
| `/moderacja slowmode sekundy: powod:`                  | 0–21600 sekund, 0 wyłącza                                                 |
| `/moderacja lock powod:`                               | Zablokuj pisanie i wątki zwykłym rolom                                    |
| `/moderacja unlock powod:`                             | Przywróć nadpisania zapisane przed lock                                   |
| `/moderacja gif-dopusc adres: powod:`                  | Zatwierdź obejrzany GIF Tenor na 30 dni; powód służy jako opis w katalogu |
| `/moderacja gif-zablokuj adres: powod:`                | Zablokuj dokładny GIF Tenor lub GIPHY                                     |
| `/ogloszenie [kanal:]`                                 | Formularz, prywatny podgląd i publikacja po kliknięciu autora             |

Hierarchia ról jest sprawdzana. Moderator nie może moderować Ownera, innych moderatorów ani osób z równą / wyższą rolą. Role Owner, Moderator, poziomów, kwarantanny i Booster są chronione w komendzie rola. Timeout nie może skracać kwarantanny.

## GIF-y

| Komenda                       | Działanie                                                 |
| ----------------------------- | --------------------------------------------------------- |
| `/gif szukaj: [zrodlo:giphy]` | Do 5 wyników GIPHY z klasyfikacją G; wymaga GIPHY_API_KEY |
| `/gif szukaj: zrodlo:tenor`   | Wyszukaj w katalogu zatwierdzonym przez administrację     |

Dla użytkowników od poziomu 20. API Tenor zostało zamknięte 30 czerwca 2026, więc bot nie próbuje z niego korzystać. Publiczne wyszukiwanie wykorzystuje GIPHY; gotowe GIF-y Tenor mogą przejść ręczną akceptację.

## Prywatny voice

| Komenda / przycisk                 | Działanie                                              |
| ---------------------------------- | ------------------------------------------------------ |
| Wejście na **1555036112148365393** | Tworzy własny pokój lub przenosi do istniejącego       |
| `/voice panel`                     | Publiczny panel Twojego obecnego prywatnego pokoju     |
| **Nazwa**                          | Formularz nazwy 2–100 znaków, zmiana co 5 min          |
| **Limit 1–99**                     | Formularz limitu uczestników                           |
| **Zablokuj / Odblokuj**            | Dostęp do wejścia; odtworzenie wcześniejszych nadpisań |
| **Ukryj / Pokaż**                  | Widoczność pokoju                                      |
| **Wyrzuć**                         | Wybierz uczestnika do rozłączenia                      |
| **Zablokuj osobę**                 | Odmów wejścia i widoczności konkretnej osobie          |
| **Odblokuj osobę**                 | Usuń osobistą blokadę                                  |
| **Zaproś osobę**                   | Pozwól wejść także do zablokowanego pokoju             |
| **Przekaż pokój**                  | Nowy właściciel musi być na pokoju i nie mieć własnego |
| **Przejmij bez właściciela**       | Przejęcie przez uczestnika, gdy właściciela nie ma     |
| **Odśwież**                        | Zaktualizuj stan panelu                                |
| **Zamknij pokój**                  | Usuń własny pokój                                      |

Panel jest w czacie voice. Właściciel zarządza podczas obecności na pokoju; administracja może także z zewnątrz. Dialogi ustawień są prywatne, stan pokoju widoczny na panelu. Puste pokoje usuwają się po 15 sekundach.

## Setup i administracja — tylko Owner

| Komenda                                           | Działanie                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `/setup`                                          | Ochrona nowych kont, panel Roblox i konfiguracja voice                     |
| `/setup-regulamin [kanal:]`                       | Regulamin z Twoim banerem i akceptacją; aktualizuje zapisany panel         |
| `/setup-weryfikacja`                              | Utwórz / odśwież przycisk weryfikacji                                      |
| `/setup-voice`                                    | Konfiguracja wejścia, kategorii i instrukcji voice                         |
| `/admin diagnostyka`                              | Role, kanały, prawa, kolejka logów, konfiguracja GIF i ochrony             |
| `/admin publikuj panel:rules/info/guide [kanal:]` | Opublikuj dodatkowy regulamin / informacje / poradnik                      |
| `/admin synchronizacja`                           | Community, poziomy i zapisany nick Roblox członków; respektuje kwarantannę |
| `/admin poziom osoba: wartosc: powod:`            | Ustaw poziom 0–100 i role progowe                                          |
| `/admin waluta osoba: zmiana: powod:`             | Zmień saldo z historią; zakres ±100 000 000                                |
| `/admin kwarantanna osoba: powod:`                | Zwolnij wcześniej z ochrony, po ukończeniu Membership Screening            |
| `/admin backup`                                   | Spójna kopia SQLite w /data/backups                                        |
