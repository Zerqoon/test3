import { config } from '../config.js';
import { logger } from '../logger.js';
import { playerRepo } from '../database/repositories.js';
import type { RobloxUser } from '../types.js';

interface RobloxUserApiItem {
  id: number;
  name: string;
  displayName?: string;
}

interface RobloxUsersBatchResponse {
  data?: RobloxUserApiItem[];
}

interface RobloxThumbnailsBatchResponse {
  data?: Array<{
    targetId: number;
    state: string;
    imageUrl?: string;
  }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.API_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class RobloxClient {
  private readonly usersBase = config.ROBLOX_USERS_API_BASE.replace(/\/+$/, '');
  private readonly thumbsBase = config.ROBLOX_THUMBNAILS_API_BASE.replace(/\/+$/, '');

  /**
   * Pobiera profil pojedynczego gracza po UserID (z cache SQLite lub API)
   */
  async getUser(userId: number): Promise<RobloxUser> {
    const cached = playerRepo.get(userId);
    const now = Date.now();

    if (cached && now - Number(cached.last_seen_at ?? 0) < 24 * 60 * 60 * 1000) {
      return {
        id: userId,
        name: String(cached.username),
        displayName: String(cached.display_name ?? cached.username),
        avatarUrl: cached.avatar_url ? String(cached.avatar_url) : null
      };
    }

    const batch = await this.hydrateUsers([userId]);
    const found = batch.get(userId);
    if (found) return found;

    return {
      id: userId,
      name: `User_${userId}`,
      displayName: `User_${userId}`,
      avatarUrl: null
    };
  }

  /**
   * Uniwersalna metoda resolve wspierająca komendy (obsługuje nick lub UserID)
   */
  async resolve(input: string): Promise<RobloxUser> {
    const cleaned = input.trim();
    const isId = /^\d+$/.test(cleaned);

    // 1. Jeśli podano ID, sprawdź najpierw bazę SQLite
    if (isId) {
      const numericId = Number(cleaned);
      const cached = playerRepo.get(numericId);
      if (cached) {
        return {
          id: numericId,
          name: String(cached.username),
          displayName: String(cached.display_name ?? cached.username),
          avatarUrl: cached.avatar_url ? String(cached.avatar_url) : null
        };
      }
      return this.getUser(numericId);
    }

    // 2. Jeśli podano nick, wyszukaj UserID przez API Robloxa
    let id: number;
    let name: string;
    let displayName: string;

    try {
      const response = await fetchWithTimeout(`${this.usersBase}/v1/usernames/users`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'R3V0-PS99-Whitelist-Bot/1.2'
        },
        body: JSON.stringify({ usernames: [cleaned], excludeBannedUsers: false })
      });

      if (response.status === 429) {
        logger.warn({ input }, '[ROBLOX] Rate limit 429 on username lookup, waiting 1.5s...');
        await sleep(1500);
      }

      if (!response.ok) {
        throw new Error(`Roblox username lookup failed: HTTP ${response.status}`);
      }

      const json = (await response.json()) as { data?: Array<{ id: number; name: string; displayName?: string }> };
      const user = json.data?.[0];
      if (!user) throw new Error(`Roblox user not found: ${cleaned}`);

      id = Number(user.id);
      name = String(user.name);
      displayName = String(user.displayName ?? user.name);
    } catch (err: unknown) {
      logger.error({ input, error: err instanceof Error ? err.message : String(err) }, '[ROBLOX] Username resolution error');
      throw err;
    }

    // Pobranie awatara
    let avatarUrl: string | null = null;
    try {
      const thumbRes = await fetchWithTimeout(
        `${this.thumbsBase}/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`,
        {
          headers: {
            accept: 'application/json',
            'user-agent': 'R3V0-PS99-Whitelist-Bot/1.2'
          }
        }
      );

      if (thumbRes.ok) {
        const thumbJson = (await thumbRes.json()) as RobloxThumbnailsBatchResponse;
        avatarUrl = thumbJson.data?.[0]?.imageUrl ?? null;
      }
    } catch (_thumbErr) {
      logger.warn({ userId: id }, '[ROBLOX] Avatar lookup failed; continuing without avatar');
    }

    const result: RobloxUser = { id, name, displayName, avatarUrl };
    playerRepo.upsert(result);
    return result;
  }

  /**
   * Hurtowa hydratacja wielu graczy (do 100 na raz w 2 requestach)
   */
  async hydrateUsers(userIds: number[]): Promise<Map<number, RobloxUser>> {
    const result = new Map<number, RobloxUser>();
    const missingIds: number[] = [];
    const now = Date.now();

    // 1. Sprawdź, kogo mamy w bazie
    for (const id of userIds) {
      const cached = playerRepo.get(id);
      if (cached && now - Number(cached.last_seen_at ?? 0) < 24 * 60 * 60 * 1000) {
        result.set(id, {
          id,
          name: String(cached.username),
          displayName: String(cached.display_name ?? cached.username),
          avatarUrl: cached.avatar_url ? String(cached.avatar_url) : null
        });
      } else {
        missingIds.push(id);
      }
    }

    if (!missingIds.length) {
      return result;
    }

    // 2. Pobieraj brakujące ID w paczkach po 100
    const chunkSize = 100;
    for (let i = 0; i < missingIds.length; i += chunkSize) {
      const chunk = missingIds.slice(i, i + chunkSize);

      try {
        const usersRes = await fetchWithTimeout(`${this.usersBase}/v1/users`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': 'R3V0-PS99-Whitelist-Bot/1.2'
          },
          body: JSON.stringify({ userIds: chunk, excludeBannedUsers: false })
        });

        if (usersRes.status === 429) {
          logger.warn('[ROBLOX] Rate limit 429 in batch lookup, applying backoff');
          await sleep(2000);
          continue;
        }

        if (!usersRes.ok) {
          logger.warn({ status: usersRes.status }, '[ROBLOX] Batch user request failed');
          continue;
        }

        const usersJson = (await usersRes.json()) as RobloxUsersBatchResponse;
        const usersData = usersJson.data ?? [];

        // Pobranie awatarów dla całej paczki
        const thumbsRes = await fetchWithTimeout(
          `${this.thumbsBase}/v1/users/avatar-headshot?userIds=${chunk.join(',')}&size=150x150&format=Png&isCircular=false`,
          {
            headers: {
              accept: 'application/json',
              'user-agent': 'R3V0-PS99-Whitelist-Bot/1.2'
            }
          }
        );

        const thumbsMap = new Map<number, string>();
        if (thumbsRes.ok) {
          const thumbsJson = (await thumbsRes.json()) as RobloxThumbnailsBatchResponse;
          for (const t of thumbsJson.data ?? []) {
            if (t.imageUrl && t.state === 'Completed') {
              thumbsMap.set(t.targetId, t.imageUrl);
            }
          }
        }

        // Zapisz do pamięci i zaktualizuj bazę SQLite
        for (const u of usersData) {
          const userObj: RobloxUser = {
            id: u.id,
            name: u.name,
            displayName: u.displayName || u.name,
            avatarUrl: thumbsMap.get(u.id) ?? null
          };

          result.set(u.id, userObj);
          playerRepo.upsert(userObj);
        }
      } catch (err: unknown) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          '[ROBLOX] Batch user hydration failed'
        );
      }
    }

    // Bezpieczny fallback dla graczy, których Roblox nie zwrócił (np. konta usunięte)
    for (const id of userIds) {
      if (!result.has(id)) {
        const fallbackCached = playerRepo.get(id);
        result.set(id, {
          id,
          name: fallbackCached ? String(fallbackCached.username) : `User_${id}`,
          displayName: fallbackCached ? String(fallbackCached.display_name ?? fallbackCached.username) : `User_${id}`,
          avatarUrl: fallbackCached?.avatar_url ? String(fallbackCached.avatar_url) : null
        });
      }
    }

    return result;
  }
}
