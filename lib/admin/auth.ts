import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const adminSessionCookieName = "modelmux_admin_session";

const sessionLifetimeSeconds = 8 * 60 * 60;
const loginWindowMs = 10 * 60 * 1000;
const loginBlockMs = 15 * 60 * 1000;
const maxLoginFailures = 5;

interface AdminCredentials {
  password: string;
  sessionSecret: string;
}

interface LoginAttempt {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

interface AdminSession {
  expiresAt: number;
}

declare global {
  var __modelmuxAdminLoginAttempts: Map<string, LoginAttempt> | undefined;
}

function credentials(): AdminCredentials | null {
  const password = process.env.MODELMUX_ADMIN_PASSWORD?.trim();
  const sessionSecret = process.env.MODELMUX_ADMIN_SESSION_SECRET?.trim();
  if (!password || !sessionSecret || sessionSecret.length < 32) return null;
  return { password, sessionSecret };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function equalSecret(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function signingKey(config: AdminCredentials): Buffer {
  return createHmac("sha256", config.sessionSecret)
    .update(config.password)
    .digest();
}

function signPayload(payload: string, config: AdminCredentials): string {
  return createHmac("sha256", signingKey(config)).update(payload).digest("base64url");
}

function loginAttempts(): Map<string, LoginAttempt> {
  globalThis.__modelmuxAdminLoginAttempts ??= new Map();
  return globalThis.__modelmuxAdminLoginAttempts;
}

function clientAddress(request: Request): string {
  if (process.env.MODELMUX_TRUST_PROXY !== "true") return "direct-client";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown-proxy-client";
}

function attemptKey(request: Request): string {
  return createHash("sha256").update(clientAddress(request)).digest("hex");
}

export function adminAuthConfigured(): boolean {
  return credentials() !== null;
}

export function verifyAdminPassword(password: string): boolean {
  const config = credentials();
  return Boolean(config && equalSecret(password, config.password));
}

export function createAdminSessionToken(now = Date.now()): string {
  const config = credentials();
  if (!config) throw new Error("admin_auth_not_configured");
  const expiresAt = Math.floor(now / 1000) + sessionLifetimeSeconds;
  const payload = `v1.${expiresAt}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signPayload(payload, config)}`;
}

export function verifyAdminSessionToken(
  token: string | undefined,
  now = Date.now(),
): AdminSession | null {
  const config = credentials();
  if (!config || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [version, expiresValue, nonce, signature] = parts;
  const expiresAt = Number(expiresValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000) || !nonce || !signature) {
    return null;
  }
  const payload = `${version}.${expiresValue}.${nonce}`;
  if (!equalSecret(signature, signPayload(payload, config))) return null;
  return { expiresAt };
}

export function setAdminSessionCookie(
  response: NextResponse,
  request: NextRequest,
  token: string,
): void {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  response.cookies.set(adminSessionCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: forwardedProto === "https" || request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: sessionLifetimeSeconds,
    priority: "high",
  });
}

export function clearAdminSessionCookie(response: NextResponse): void {
  response.cookies.set(adminSessionCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export function requireAdmin(request: NextRequest): AdminSession | NextResponse {
  if (!adminAuthConfigured()) {
    return NextResponse.json({ error: "管理员登录尚未配置" }, { status: 503 });
  }
  const session = verifyAdminSessionToken(request.cookies.get(adminSessionCookieName)?.value);
  return session ?? NextResponse.json({ error: "管理员登录状态已失效" }, { status: 401 });
}

export function adminLoginRetryAfter(request: Request, now = Date.now()): number {
  const attempt = loginAttempts().get(attemptKey(request));
  if (!attempt || attempt.blockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000));
}

export function recordAdminLoginFailure(request: Request, now = Date.now()): void {
  const key = attemptKey(request);
  const current = loginAttempts().get(key);
  const attempt = !current || now - current.windowStartedAt >= loginWindowMs
    ? { failures: 0, windowStartedAt: now, blockedUntil: 0 }
    : current;
  attempt.failures += 1;
  if (attempt.failures >= maxLoginFailures) attempt.blockedUntil = now + loginBlockMs;
  loginAttempts().set(key, attempt);
}

export function clearAdminLoginFailures(request: Request): void {
  loginAttempts().delete(attemptKey(request));
}
