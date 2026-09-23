import { z, ZodError } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { cacheRepo } from '../database/repositories.js';
import {
  legacyClanSchema,
  activeBattleSchema,
  rapRowSchema,
  petConfigSchema,
  type LegacyClan,
  type ActiveBattle,
  type RapRow,
  type PetConfig
} from './schemas.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const responseEnvelope = z.object({
  status: z.string(),
  data: z.unknown().nullable().optional(),
  error: z.union([
    z.string(),
    z.object({
      message: z.string(),
      ignore: z.boolean().optional()
    }).passthrough()
  ]).optional(),
  message: z.string().optional()
}).passthrough();

export class BigGamesHttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'BigGamesHttpError';
  }
}

function cleanClanName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export class BigGamesClient {
  private inflight = new Map<string, Promise<unknown>>();
  private readonly baseUrl = config.BIGGAMES_API_BASE.replace(/\/+$/, '');

  async get<T>(
    path: string,
    schema: z.ZodType<T>,
    ttlMs = 60_000,
    allowStale = true,
    retry404 = false
  ): Promise<{ data: T; source: 'live' | 'cache' | 'stale'; fetchedAt: number }> {
    const key = `GET:${path}`;
    const cached = cacheRepo.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      try {
        const parsed = schema.parse(cached.value);
        return { data: parsed, source: 'cache', fetchedAt: cached.fetchedAt };
      } catch (_err) {
        logger.warn({ path }, '[BIGGAMES] Cache entry failed schema parse, refreshing live data');
      }
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<{ data: T; source: 'live' | 'cache' | 'stale'; fetchedAt: number }>;
    }

    const promise = this.fetchWithRetry(path, schema, ttlMs, cached, allowStale, retry404)
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchWithRetry<T>(
    path: string,
    schema: z.ZodType<T>,
    ttlMs: number,
    cached: { value: unknown; fetchedAt: number } | null | undefined,
    allowStale: boolean,
    retry404: boolean
  ): Promise<{ data: T; source: 'live' | 'stale'; fetchedAt: number }> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.API_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.API_TIMEOUT_MS);
      const startedAt = Date.now();
      const url = `${this.baseUrl}${path}`;

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'user-agent': 'R3V0-PS99-Whitelist-Bot/1.2',
            accept: 'application/json'
          }
        });

        let json: unknown = null;
        let jsonParseError: unknown = null;

        try {
          json = await response.json();
        } catch (error) {
          jsonParseError = error;
        }

        const elapsedMs = Date.now() - startedAt;
        const hasData = Boolean(
          json &&
          typeof json === 'object' &&
          'data' in json &&
          (json as Record<string, unknown>).data !== null &&
          (json as Record<string, unknown>).data !== undefined
        );

        const apiStatus = json && typeof json === 'object' && 'status' in json
          ? String((json as Record<string, unknown>).status)
          : 'unknown';

        logger.info({
          path,
          status: response.status,
          ms: elapsedMs,
          hasData,
          apiStatus,
          attempt
        }, '[BIGGAMES] HTTP response');

        if (jsonParseError) {
          throw new BigGamesHttpError(`Invalid JSON response (HTTP ${response.status})`, response.status);
        }

        if (!response.ok) {
          throw new BigGamesHttpError(
            `HTTP ${response.status}`,
            response.status,
            retryAfterMs(response.headers.get('retry-after'))
          );
        }

        const outer = responseEnvelope.parse(json);
        if (outer.status !== 'ok') {
          const errMessage = typeof outer.error === 'string'
            ? outer.error
            : outer.error?.message ?? outer.message ?? 'BIG Games API returned status=error';

          throw new BigGamesHttpError(errMessage, response.status);
        }

        try {
          const data = schema.parse(outer.data);
          cacheRepo.set(`GET:${path}`, data, ttlMs);
          return { data, source: 'live' as const, fetchedAt: Date.now() };
        } catch (schemaError) {
          if (schemaError instanceof ZodError) {
            logger.error({
              path,
              issues: schemaError.issues
            }, '[BIGGAMES] Schema validation failed for returned data');
          }
          throw schemaError;
        }
      } catch (error: unknown) {
        lastError = error;
        const status = error instanceof BigGamesHttpError ? error.status : undefined;
        const isTimeout = error instanceof Error && error.name === 'AbortError';
        const retryable = isTimeout || status === 429 || (status != null && status >= 500) || (retry404 && status === 404);

        logger.warn({
          path,
          attempt,
          status: status ?? null,
          timeout: isTimeout,
          error: error instanceof Error ? error.message : String(error)
        }, '[BIGGAMES] request failed');

        const retryBudget = status === 404 ? Math.min(1, config.API_RETRIES) : config.API_RETRIES;
        if (!retryable || attempt >= retryBudget) break;

        const retry404Delay = status === 404 ? 250 : undefined;
        const exponential = Math.min(5000, 350 * 2 ** attempt);
        const delay = error instanceof BigGamesHttpError && error.retryAfterMs != null
          ? Math.min(error.retryAfterMs, 10_000)
          : retry404Delay ?? exponential;

        await sleep(delay);
      } finally {
        clearTimeout(timer);
      }
    }

    if (allowStale && cached) {
      try {
        const parsed = schema.parse(cached.value);
        logger.warn({ path, fetchedAt: cached.fetchedAt }, '[BIGGAMES] using stale cache fallback');
        return {
          data: parsed,
          source: 'stale' as const,
          fetchedAt: cached.fetchedAt
        };
      } catch (_cacheErr) {
        logger.error({ path }, '[BIGGAMES] stale cache fallback failed schema validation');
      }
    }

    throw lastError instanceof Error ? lastError : new Error('BIG Games request failed');
  }

  async clansList(): Promise<{ data: string[]; source: 'live' | 'cache' | 'stale'; fetchedAt: number }> {
    return this.get('/api/clansList', z.array(z.string()), 10 * 60_000, true);
  }

  async clan(name: string): Promise<{ data: LegacyClan; source: 'live' | 'cache' | 'stale'; fetchedAt: number }> {
    const cleaned = cleanClanName(name);
    if (!cleaned) throw new Error('Clan name is empty after normalization');

    // 1. Sprawdzanie wariantów wielkości liter
    const candidates = [...new Set([cleaned, cleaned.toUpperCase(), cleaned.toLowerCase()])];
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const result = await this.get(
          `/api/clan/${encodeURIComponent(candidate)}`,
          legacyClanSchema.nullable(),
          60_000,
          true,
          false // Nie marnujemy czasu na retry przy 404
        );

        if (result.data) {
          return {
            ...result,
            data: result.data
          };
        }

        lastError = new Error(`Clan ${candidate} returned data=null`);
      } catch (error) {
        lastError = error;
      }
    }

    // 2. Jeśli bezpośrednie warianty nie zadziałały, wyszukaj oficjalną nazwę na liście klanów
    try {
      const list = await this.clansList();
      const canonical = list.data.find(
        (clanName) => clanName.toLocaleLowerCase('en-US') === cleaned.toLocaleLowerCase('en-US')
      );

      if (canonical && !candidates.includes(canonical)) {
        const result = await this.get(
          `/api/clan/${encodeURIComponent(canonical)}`,
          legacyClanSchema.nullable(),
          60_000,
          true,
          false
        );

        if (result.data) {
          return {
            ...result,
            data: result.data
          };
        }
      }
    } catch (error) {
      lastError = error;
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Clan not found: ${cleaned}`);
  }

  async activeBattle(): Promise<{ data: ActiveBattle | null; source: 'live' | 'cache' | 'stale'; fetchedAt: number }> {
    return this.get('/api/activeClanBattle', activeBattleSchema.nullable(), 60_000, true);
  }

  async rap(): Promise<{ data: RapRow[]; source: 'live' | 'cache' | 'stale'; fetchedAt: number }> {
    return this.get('/api/rap', z.array(rapRowSchema), 4 * 60 * 60_000, true);
  }

  async pets(): Promise<{ data: PetConfig[]; source: 'live' | 'cache' | 'stale'; fetchedAt: number }> {
    return this.get('/api/collection/Pets', z.array(petConfigSchema), 6 * 60 * 60_000, true);
  }

  async clanLeaderboard(
    page = 1,
    pageSize = 25
  ): Promise<{ data: Array<Record<string, unknown>>; source: 'live' | 'cache' | 'stale'; fetchedAt: number }> {
    return this.get(
      `/api/clans?page=${page}&pageSize=${pageSize}&sort=Points&sortOrder=desc`,
      z.array(z.record(z.string(), z.unknown())),
      60_000,
      true
    );
  }
}