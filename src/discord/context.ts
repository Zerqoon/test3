import { BigGamesClient } from '../api/BigGamesClient.js';
import { RobloxClient } from '../api/RobloxClient.js';
import { WhitelistService } from '../services/WhitelistService.js';
import { PlayerService } from '../services/PlayerService.js';
import { HistoryService } from '../services/HistoryService.js';
import { RapService } from '../services/RapService.js';
import { TrackerScheduler } from '../jobs/TrackerScheduler.js';

export function createContext() {
  const big = new BigGamesClient();
  const roblox = new RobloxClient();
  const whitelist = new WhitelistService(big, roblox);
  const player = new PlayerService(roblox, whitelist);
  const history = new HistoryService();
  const rap = new RapService(big);
  const scheduler = new TrackerScheduler(whitelist, history);

  return { big, roblox, whitelist, player, history, rap, scheduler };
}

export type AppContext = ReturnType<typeof createContext>;
