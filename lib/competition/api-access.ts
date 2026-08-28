import { randomBytes } from "node:crypto";

export function generateContestantApiKey(): string {
  return `sk-competition-${randomBytes(24).toString("base64url")}`;
}
