import { randomBytes } from "node:crypto";

const fallbackRequestQuota = 1_000;

export function contestantDefaultRequestQuota(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(env.MODELMUX_CONTESTANT_REQUEST_QUOTA ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : fallbackRequestQuota;
}

export function generateContestantApiKey(): string {
  return `sk-competition-${randomBytes(24).toString("base64url")}`;
}
