import { migrate } from '../src/database/db.js';
import { BigGamesClient } from '../src/api/BigGamesClient.js';
import { config } from '../src/config.js';
import { normalizeClan } from '../src/services/ClanNormalizer.js';

migrate();
const big = new BigGamesClient();
const response = await big.clan(config.MAIN_CLAN);
const clan = normalizeClan(response.data);

console.log({
  clan: clan.name,
  members: clan.members.length,
  owner: clan.ownerId,
  battleId: clan.battleId,
  battlePoints: clan.battlePoints,
  battlePlace: clan.battlePlace,
  topContributors: [...clan.members]
    .sort((a, b) => b.battlePoints - a.battlePoints)
    .slice(0, 5)
    .map(member => ({
      userId: member.userId,
      points: member.battlePoints,
      diamonds: member.diamonds,
      owner: member.isOwner
    })),
  source: response.source
});
