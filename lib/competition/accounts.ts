import { z } from "zod";

export const createCompetitionUserSchema = z.object({
  role: z.literal("contestant"),
  username: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
});

export const autoCreateCompetitionUserSchema = z.object({
  role: z.literal("contestant"),
  autoGenerate: z.literal(true),
});

export const createCompetitionUserRequestSchema = z.union([
  createCompetitionUserSchema,
  autoCreateCompetitionUserSchema,
]);
