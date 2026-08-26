import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { adminAuthConfigured, verifyAdminPassword } from "../admin/auth";

export const screenSessionCookieName = "modelmux_competition_screen_session";

const sessionLifetimeSeconds = 8 * 60 * 60;
const loginWindowMs = 10 * 60 * 1000;
const loginBlockMs = 15 * 60 * 1000;
const maxLoginFailures = 5;

interface ScreenCredentials {
  password: string;
  sessionSecret: string;
}

interface ScreenSession {
  expiresAt: number;
}

interface LoginAttempt {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

declare global {
  var __modelmuxScreenLoginAttempts: Map<string, LoginAttempt> | undefined;
}

function credentials(): ScreenCredentials | null {
  if (!adminAuthConfigured()) return null;
  return {
    password: process.env.MODELMUX_ADMIN_PASSWORD!.trim(),
    sessionSecret: process.env.MODELMUX_ADMIN_SESSION_SECRET!.trim(),
  };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function equalSecret(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function signingKey(config: ScreenCredentials): Buffer {
  return createHmac("sha256", config.sessionSecret)
    .update("modelmux:competition-screen:v1\0")
    .update(config.password)
    .digest();
}

function signPayload(payload: string, config: ScreenCredentials): string {
  return createHmac("sha256", signingKey(config)).update(payload).digest("base64url");
}

function loginAttempts(): Map<string, LoginAttempt> {
  globalThis.__modelmuxScreenLoginAttempts ??= new Map();
  return globalThis.__modelmuxScreenLoginAttempts;
}

function clientAddress(request: Request): string {
  if (process.env.MODELMUX_TRUST_PROXY !== "true") return "direct-client";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown-proxy-client";
}

function attemptKey(request: Request): string {
  return createHash("sha256").update(clientAddress(request)).digest("hex");
}

export function screenAuthConfigured(): boolean {
  return adminAuthConfigured();
}

export function verifyScreenPassword(password: string): boolean {
  return verifyAdminPassword(password);
}

export function createScreenSessionToken(now = Date.now()): string {
  const config = credentials();
  if (!config) throw new Error("screen_auth_not_configured");
  const expiresAt = Math.floor(now / 1000) + sessionLifetimeSeconds;
  const payload = `screen.v1.${expiresAt}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signPayload(payload, config)}`;
}

export function verifyScreenSessionToken(
  token: string | undefined,
  now = Date.now(),
): ScreenSession | null {
  const config = credentials();
  if (!config || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "screen" || parts[1] !== "v1") return null;
  const [audience, version, expiresValue, nonce, signature] = parts;
  const expiresAt = Number(expiresValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000) || !nonce || !signature) {
    return null;
  }
  const payload = `${audience}.${version}.${expiresValue}.${nonce}`;
  if (!equalSecret(signature, signPayload(payload, config))) return null;
  return { expiresAt };
}

export function setScreenSessionCookie(
  response: NextResponse,
  request: NextRequest,
  token: string,
): void {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  response.cookies.set(screenSessionCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: forwardedProto === "https" || request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: sessionLifetimeSeconds,
    priority: "high",
  });
}

export function requireCompetitionScreen(request: NextRequest): ScreenSession | NextResponse {
  if (!screenAuthConfigured()) {
    return NextResponse.json(
      { error: "大屏访问密码尚未配置" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const session = verifyScreenSessionToken(request.cookies.get(screenSessionCookieName)?.value);
  return session ?? NextResponse.json(
    { error: "大屏访问状态已失效" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export function screenLoginRetryAfter(request: Request, now = Date.now()): number {
  const attempt = loginAttempts().get(attemptKey(request));
  if (!attempt || attempt.blockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000));
}

export function recordScreenLoginFailure(request: Request, now = Date.now()): void {
  const key = attemptKey(request);
  const current = loginAttempts().get(key);
  const attempt = !current || now - current.windowStartedAt >= loginWindowMs
    ? { failures: 0, windowStartedAt: now, blockedUntil: 0 }
    : current;
  attempt.failures += 1;
  if (attempt.failures >= maxLoginFailures) attempt.blockedUntil = now + loginBlockMs;
  loginAttempts().set(key, attempt);
}

export function clearScreenLoginFailures(request: Request): void {
  loginAttempts().delete(attemptKey(request));
}
