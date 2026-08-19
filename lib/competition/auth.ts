import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { competitionPool, ensureCompetitionSchema, rows } from "./db";
import type { CompetitionRole, SessionUser } from "./types";

const scrypt = promisify(scryptCallback);
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const loginWindowMs = 10 * 60 * 1000;
const loginBlockMs = 15 * 60 * 1000;
const maxLoginFailures = 8;

interface LoginAttempt {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

// 统一登录入口事先不知道角色，限流仍要能按"账号 + 来源"计数，
// 所以失败计数的分桶维度是"角色或 any"，而不是必须的 CompetitionRole。
export type LoginScope = CompetitionRole | "any";

export interface CredentialMatch {
  id: number;
  role: CompetitionRole;
  username: string;
  displayName: string;
}

declare global {
  var __modelmuxCompetitionLoginAttempts: Map<string, LoginAttempt> | undefined;
}

// 选手端和评委端共用一个会话 cookie：同一台电脑同一时刻只能是一个身份，
// 换身份必须先退出。管理后台的 modelmux_admin_session 与此完全独立。
export const sessionCookieName = "modelmux_competition_session";

interface UserCredentialRow extends RowDataPacket {
  id: number;
  role: CompetitionRole;
  username: string;
  display_name: string;
  password_hash: string;
  active: number;
  deleted_at: string | null;
}

interface SessionRow extends RowDataPacket {
  id: number;
  role: CompetitionRole;
  username: string;
  display_name: string;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function loginAttempts(): Map<string, LoginAttempt> {
  globalThis.__modelmuxCompetitionLoginAttempts ??= new Map();
  return globalThis.__modelmuxCompetitionLoginAttempts;
}

function clientAddress(request: Request): string {
  if (process.env.MODELMUX_TRUST_PROXY !== "true") return "direct-client";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown-proxy-client";
}

function attemptKey(request: Request, role: LoginScope, username: string): string {
  return createHash("sha256")
    .update(clientAddress(request))
    .update("\0")
    .update(role)
    .update("\0")
    .update(normalizeUsername(username))
    .digest("hex");
}

export function competitionLoginRetryAfter(
  request: Request,
  role: LoginScope,
  username: string,
  now = Date.now(),
): number {
  const attempt = loginAttempts().get(attemptKey(request, role, username));
  if (!attempt || attempt.blockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000));
}

export function recordCompetitionLoginFailure(
  request: Request,
  role: LoginScope,
  username: string,
  now = Date.now(),
): void {
  const key = attemptKey(request, role, username);
  const current = loginAttempts().get(key);
  const attempt = !current || now - current.windowStartedAt >= loginWindowMs
    ? { failures: 0, windowStartedAt: now, blockedUntil: 0 }
    : current;
  attempt.failures += 1;
  if (attempt.failures >= maxLoginFailures) attempt.blockedUntil = now + loginBlockMs;
  loginAttempts().set(key, attempt);
}

export function clearCompetitionLoginFailures(
  request: Request,
  role: LoginScope,
  username: string,
): void {
  loginAttempts().delete(attemptKey(request, role, username));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * competition_users 的唯一键是 (role, username)，同一个账号名可以既是选手号又是评委号，
 * 所以统一登录必须把该用户名下的每条记录都验一遍密码，由调用方决定命中多条时怎么办。
 * 传入 role 时退化为单角色校验，行为与旧的按角色登录一致。
 */
export async function matchCredentials(
  username: string,
  password: string,
  role?: CompetitionRole,
): Promise<CredentialMatch[]> {
  const normalized = normalizeUsername(username);
  const records = role
    ? await rows<UserCredentialRow[]>(
        `SELECT id, role, username, display_name, password_hash, active, deleted_at
         FROM competition_users
         WHERE username = ? AND deleted_at IS NULL AND role = ?`,
        [normalized, role],
      )
    : await rows<UserCredentialRow[]>(
        `SELECT id, role, username, display_name, password_hash, active, deleted_at
         FROM competition_users
         WHERE username = ? AND deleted_at IS NULL`,
        [normalized],
      );

  const matches: CredentialMatch[] = [];
  for (const record of records) {
    if (!record.active) continue;
    if (!(await verifyPassword(password, record.password_hash))) continue;
    matches.push({
      id: record.id,
      role: record.role,
      username: record.username,
      displayName: record.display_name,
    });
  }
  return matches;
}

export async function issueSession(
  match: CredentialMatch,
): Promise<{ token: string; user: SessionUser }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await ensureCompetitionSchema();
  await competitionPool().execute<ResultSetHeader>(
    `INSERT INTO competition_sessions (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [match.id, tokenHash(token), expiresAt],
  );
  await competitionPool().execute(
    "UPDATE competition_users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
    [match.id],
  );

  return {
    token,
    user: {
      id: match.id,
      role: match.role,
      username: match.username,
      displayName: match.displayName,
    },
  };
}

export async function createSession(
  role: CompetitionRole,
  username: string,
  password: string,
): Promise<{ token: string; user: SessionUser } | null> {
  const match = (await matchCredentials(username, password, role))[0];
  return match ? issueSession(match) : null;
}

export async function sessionUserFromToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const matches = await rows<SessionRow[]>(
    `SELECT u.id, u.role, u.username, u.display_name
     FROM competition_sessions s
     INNER JOIN competition_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP(3)
       AND s.revoked_at IS NULL
       AND u.active = TRUE AND u.deleted_at IS NULL
     LIMIT 1`,
    [tokenHash(token)],
  );
  const record = matches[0];
  return record
    ? {
        id: record.id,
        role: record.role,
        username: record.username,
        displayName: record.display_name,
      }
    : null;
}

export async function sessionUser(request: NextRequest): Promise<SessionUser | null> {
  return sessionUserFromToken(request.cookies.get(sessionCookieName)?.value);
}

export async function destroySession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(sessionCookieName)?.value;
  if (!token) return;
  await ensureCompetitionSchema();
  await competitionPool().execute(
    "UPDATE competition_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE token_hash = ? AND revoked_at IS NULL",
    [tokenHash(token)],
  );
}

export function setSessionCookie(
  response: NextResponse,
  request: NextRequest,
  token: string,
): void {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: forwardedProto === "https" || request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: Math.floor(sessionLifetimeMs / 1000),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export function hasSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return Boolean(host && origin === `${protocol}://${host}`);
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "登录状态已失效，请重新登录" }, { status: 401 });
}

// 会话有效但身份不对（比如评委去调选手接口）。这里必须是 403 而不是 401，
// 否则前端会把一个正常登录的用户当成掉线，踢回登录页再被弹回来。
export function forbidden(): NextResponse {
  return NextResponse.json({ error: "当前登录身份无权访问该接口" }, { status: 403 });
}
