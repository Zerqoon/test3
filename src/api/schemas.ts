import { z } from 'zod';

export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.union([
    z.object({
      status: z.literal('ok'),
      data
    }).passthrough(),
    z.object({
      status: z.literal('error'),
      error: z.union([
        z.string(),
        z.object({
          message: z.string(),
          ignore: z.boolean().optional()
        }).passthrough()
      ]).optional(),
      message: z.string().optional()
    }).passthrough()
  ]);

export const clanMemberSchema = z.object({
  UserID: z.number(),
  PermissionLevel: z.number().default(0),
  JoinTime: z.number().nullable().optional().default(0)
}).passthrough();

export const pointContributionSchema = z.object({
  UserID: z.number(),
  Points: z.number().default(0)
}).passthrough();

export const battleSchema = z.object({
  ProcessedAwards: z.boolean().optional(),
  AwardUserIDs: z.array(z.number()).optional().default([]),
  BattleID: z.string().optional(),
  Points: z.number().default(0),
  PointContributions: z.array(pointContributionSchema).default([]),
  Place: z.number().nullable().optional()
}).passthrough();

export const diamondContributionSchema = z.object({
  UserID: z.number(),
  Diamonds: z.number().default(0)
}).passthrough();

export const diamondContributionsSchema = z.object({
  AllTime: z.object({
    Sum: z.number().default(0),
    Data: z.array(diamondContributionSchema).default([])
  }).passthrough().optional()
}).passthrough();

export const legacyClanSchema = z.object({
  Created: z.number().optional().default(0),
  Owner: z.number().optional(),
  Name: z.string(),
  Icon: z.string().optional().default(''),
  Desc: z.string().optional().default(''),
  CountryCode: z.string().optional().default(''),
  MemberCapacity: z.number().optional().default(0),
  OfficerCapacity: z.number().optional().default(0),
  GuildLevel: z.number().optional().default(1),
  Members: z.array(clanMemberSchema).default([]),
  DepositedDiamonds: z.number().optional().default(0),
  DiamondContributions: diamondContributionsSchema.nullable().optional(),
  IconChangeTimestamp: z.number().optional(),
  BronzeMedals: z.number().optional().default(0),
  SilverMedals: z.number().optional().default(0),
  GoldMedals: z.number().optional().default(0),
  Battles: z.record(z.string(), battleSchema).nullable().optional()
}).passthrough();

export type LegacyClan = z.infer<typeof legacyClanSchema>;
export type ClanBattle = z.infer<typeof battleSchema>;
export type ClanMember = z.infer<typeof clanMemberSchema>;
export type PointContribution = z.infer<typeof pointContributionSchema>;
export type DiamondContribution = z.infer<typeof diamondContributionSchema>;

export const activeBattleSchema = z.object({
  configName: z.string(),
  configData: z.record(z.string(), z.any()).optional()
}).passthrough();

export type ActiveBattle = z.infer<typeof activeBattleSchema>;

export const rapRowSchema = z.object({
  category: z.string(),
  configData: z.record(z.string(), z.any()),
  value: z.number().default(0)
}).passthrough();

export type RapRow = z.infer<typeof rapRowSchema>;

export const petConfigSchema = z.object({
  configName: z.string(),
  category: z.string().optional(),
  configData: z.object({
    name: z.string().optional(),
    thumbnail: z.string().optional(),
    goldenThumbnail: z.string().optional()
  }).passthrough()
}).passthrough();

export type PetConfig = z.infer<typeof petConfigSchema>;