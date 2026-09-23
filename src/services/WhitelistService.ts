import { config } from '../config.js';
import { logger } from '../logger.js';
import { BigGamesClient } from '../api/BigGamesClient.js';
import { RobloxClient } from '../api/RobloxClient.js';
import { clanRepo, playerRepo, snapshotRepo, whitelistRepo } from '../database/repositories.js';
import { normalizeClan } from './ClanNormalizer.js';
import type { ClanRecord, ClanMember } from '../types.js';

export interface RefreshResult {
  clan: ClanRecord;
  clanSnapshotId: number | null;
  playerSnapshotsInserted: number;
}

export class WhitelistService {
  constructor(
    private big: BigGamesClient,
    private roblox: RobloxClient
  ) {}

  list() {
    return whitelistRepo.list();
  }

  async add(name: string, by?: string) {
    if (!whitelistRepo.has(name) && whitelistRepo.count() >= config.MAX_WHITELIST_CLANS) {
      throw new Error(`Whitelist limit ${config.MAX_WHITELIST_CLANS}`);
    }

    const result = await this.refreshDetailed(name, false);
    whitelistRepo.add(result.clan.name, by);
    return result.clan;
  }

  remove(name: string) {
    whitelistRepo.remove(name);
  }

  async refresh(name: string, saveLegacySnapshot = false): Promise<ClanRecord> {
    return (await this.refreshDetailed(name, saveLegacySnapshot)).clan;
  }

  async refreshDetailed(
    name: string,
    saveLegacySnapshot = false,
    onFetched?: (clan: ClanRecord) => void | Promise<void>
  ): Promise<RefreshResult> {
    try {
      const clanResponse = await this.big.clan(name);
      const clan = normalizeClan(clanResponse.data, Date.now());
      await onFetched?.(clan);

      const previous = clanRepo.get(clan.name) ?? clanRepo.get(name);
      clanRepo.replaceMembers(clan, Boolean(previous));
      clanRepo.upsertClan(clan);
      whitelistRepo.mark(clan.name, true);

      // Jawne typowanie parametru member i userId zapobiega TS7006
      const unknownUsers = clan.members
        .map((member: ClanMember) => member.userId)
        .filter((userId: number) => !playerRepo.get(userId));

      await this.hydrateUsers(unknownUsers.slice(0, 75));

      let clanSnapshotId: number | null = null;
      let playerSnapshotsInserted = 0;
      if (saveLegacySnapshot) {
        clanSnapshotId = snapshotRepo.insertClan(clan);
        playerSnapshotsInserted = snapshotRepo.insertPlayers(clan);
      }

      return { clan, clanSnapshotId, playerSnapshotsInserted };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      whitelistRepo.mark(name, false, msg);
      throw error;
    }
  }

  private async hydrateUsers(ids: number[]) {
    const chunks: number[][] = [];
    for (let index = 0; index < ids.length; index += 10) {
      chunks.push(ids.slice(index, index + 10));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (userId: number) => {
        try {
          const player = await this.roblox.resolve(String(userId));
          playerRepo.upsert(player);
        } catch (error) {
          logger.warn(
            { userId, error: String(error) },
            '[TRACKER] Roblox hydration failed for one user; continuing'
          );
        }
      }));
    }
  }
}
