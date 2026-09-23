export type DataState = 'fresh' | 'cached' | 'stale' | 'unavailable' | 'not-indexed';

export interface Sourced<T> {
  value: T | null;
  state: DataState;
  source: string;
  fetchedAt: number | null;
}

export interface ClanMember {
  userId: number;
  permissionLevel: number;
  joinTime: number | null;
  isOwner: boolean;
  battlePoints: number;
  diamonds: number;
}

export interface ClanRecord {
  name: string;
  ownerId: number | null;
  icon: string | null;
  description: string | null;
  memberCapacity: number;
  officerCapacity: number;
  guildLevel: number;
  countryCode: string | null;
  depositedDiamonds: number;
  bronzeMedals: number;
  silverMedals: number;
  goldMedals: number;
  members: ClanMember[];
  battleId: string | null;
  battlePoints: number;
  battlePlace: number | null;
  fetchedAt: number;
}

export interface RobloxUser {
  id: number;
  name: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface HistoryPoint {
  ts: number;
  value: number;
}

export interface ClanHistoryRow {
  timestamp: number;
  points: number;
  place: number;
  diamonds: number;
}

export interface PlayerHistoryRow {
  timestamp: number;
  points: number;
  diamonds: number;
  battleId: string;
}
