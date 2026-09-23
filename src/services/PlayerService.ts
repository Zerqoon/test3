import { RobloxClient } from '../api/RobloxClient.js';
import { clanRepo, playerRepo, whitelistRepo } from '../database/repositories.js';
import { logger } from '../logger.js';
import type { RobloxUser } from '../types.js';
import { WhitelistService } from './WhitelistService.js';

export interface PlayerMembership {
  clan_name: string;
  user_id: number;
  permission_level: number;
  is_owner: number | boolean;
  battle_points: number;
  diamonds: number;
  joined_at?: number | null;
}

export interface ResolvedPlayer {
  user: RobloxUser;
  membership: PlayerMembership | null;
}

export class PlayerService {
  constructor(
    private roblox: RobloxClient,
    private whitelist: WhitelistService
  ) {}

  /**
   * Wyszukuje gracza po nicku/ID i sprawdza jego przynależność do klanu
   */
  async resolve(input: string, clanHint?: string): Promise<ResolvedPlayer> {
    // 1. Rozpoznanie gracza w Roblox API (i zapis do cache)
    const user = await this.roblox.resolve(input);
    playerRepo.upsert(user);

    // 2. Sprawdzenie lokalnej bazy SQLite (bardzo szybkie, 0ms)
    let membership = clanRepo.memberByUser(user.id) as PlayerMembership | null;

    // 3. Jeśli podano podpowiedź klanu (clanHint), a gracza nie ma w cache:
    if (!membership && clanHint) {
      const formattedHint = clanHint.trim();
      try {
        if (!whitelistRepo.has(formattedHint)) {
          // Jeśli klan nie był na whitelist, dodajemy go
          await this.whitelist.add(formattedHint, 'player-resolver');
        } else {
          // Jeśli już jest, wymuszamy odświeżenie tego konkretnego klanu
          await this.whitelist.refresh(formattedHint, true);
        }
        membership = clanRepo.memberByUser(user.id) as PlayerMembership | null;
      } catch (err) {
        logger.warn({ clanHint, error: String(err) }, '[PLAYER_SERVICE] Nie udało się odświeżyć klanu z podpowiedzi');
      }
    }

    // 4. Bezpieczny fallback: jeśli nadal nie ma gracza, sprawdzamy tylko klany
    // które nie były dawno odświeżane (maksymalnie pierwsze 3), aby nie dostać 429
    if (!membership) {
      const clans = whitelistRepo.list();
      // Ograniczamy awaryjne odpytywanie API do max 3 klanów naraz
      const fallbackBatch = clans.slice(0, 3);

      for (const clanName of fallbackBatch) {
        try {
          await this.whitelist.refresh(clanName, false);
          membership = clanRepo.memberByUser(user.id) as PlayerMembership | null;
          if (membership) break;
        } catch (_err) {
          // Błąd jednego klanu nie przerywa pętli
        }
      }
    }

    return { user, membership: membership ?? null };
  }

  /**
   * Włącza priorytetowe śledzenie gracza
   */
  async track(input: string, clan: string, by?: string): Promise<ResolvedPlayer> {
    const resolved = await this.resolve(input, clan);

    if (!resolved.membership || resolved.membership.clan_name.toLowerCase() !== clan.trim().toLowerCase()) {
      throw new Error(`Gracz **${resolved.user.name}** nie jest obecnie zarejestrowany w klanie **${clan}**.`);
    }

    playerRepo.track(resolved.user.id, resolved.membership.clan_name, by);
    return resolved;
  }

  /**
   * Wyłącza śledzenie gracza
   */
  untrack(userId: number): void {
    playerRepo.untrack(userId);
  }

  /**
   * Zwraca listę wszystkich śledzonych graczy z bazy
   */
  tracked() {
    return playerRepo.tracked();
  }
}
