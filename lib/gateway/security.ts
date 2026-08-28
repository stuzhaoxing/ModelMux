import { createHash, timingSafeEqual } from "node:crypto";

import type { GatewayConfig } from "./types";
import { isCompetitionDatabaseConfigured } from "../competition/db";
import { authenticateContestantApiKey } from "../competition/repository";

export interface ClientIdentity {
  id: string;
  label: string;
  contestantId: number | null;
  contestantName: string | null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function equalSecret(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}

export function clientToken(request: Request): string | null {
  return bearerToken(request);
}

export async function authenticateClient(
  request: Request,
  config: GatewayConfig,
): Promise<ClientIdentity | null> {
  const candidate = clientToken(request);
  if (!candidate) return null;
  const matched = config.clientKeys.find((key) => equalSecret(key, candidate));
  if (matched) {
    const id = createHash("sha256").update(matched).digest("hex").slice(0, 12);
    return { id, label: `key_${id.slice(0, 6)}`, contestantId: null, contestantName: null };
  }

  if (!isCompetitionDatabaseConfigured()) return null;
  const contestant = await authenticateContestantApiKey(candidate);
  if (!contestant) return null;
  return {
    id: `contestant_${contestant.id}`,
    label: contestant.username,
    contestantId: contestant.id,
    contestantName: contestant.displayName,
  };
}

export function clientAuthConfigured(config: GatewayConfig): boolean {
  return (
    config.clientKeys.length > 0 ||
    isCompetitionDatabaseConfigured()
  );
}
