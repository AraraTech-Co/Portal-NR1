import { createHash, createHmac } from "crypto";
import type { Request } from "express";
import { AuthAttemptKind } from "@prisma/client";
import prisma from "../model/prisma";

/**
 * Limite de tentativas no login e no primeiro acesso. [C1-7]
 *
 * - Por conta (ou pelo que foi digitado, quando não aponta para uma conta
 *   só): 5 erros seguidos bloqueiam por 15 minutos. Login, e-mail, CPF e
 *   matrícula da MESMA conta contam juntos.
 * - Por IP: 20 erros em 15 minutos bloqueiam o IP por 15 minutos — só
 *   quando o servidor sabe o IP real (`TRUST_PROXY` configurado). Sem isso,
 *   todo mundo chega com o IP do proxy e o limite travaria a loja inteira.
 *
 * A contagem é do banco, atômica (INSERT … ON CONFLICT), e não da memória do
 * processo. Nenhuma chave nem registro guarda o que foi digitado em claro:
 * guardam um pseudônimo (HMAC). Bloqueio por conta e por IP não impede
 * ataque distribuído; é mitigação proporcional.
 */

export const ACCOUNT_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 20;
export const IP_WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;
/** Por quantos dias a conta liberada pode fazer o primeiro acesso. */
export const FIRST_ACCESS_WINDOW_DAYS = 30;
/** Quanto tempo o registro de tentativas (e o IP dele) fica guardado. */
export const ATTEMPT_RETENTION_DAYS = 90;

function chave(): Buffer {
  const segredo = process.env.TOKEN_SECRET;
  if (!segredo) throw new Error("TOKEN_SECRET ausente.");
  return createHash("sha256").update(`nr1-auth-attempt:v1:${segredo}`).digest();
}

/** O que foi digitado, sem diferença de espaço, maiúscula ou pontuação. */
export function normalizeIdentifier(raw: string): string {
  const t = raw.trim().toLowerCase();
  const digitos = t.replace(/[.\-/\s]/g, "");
  return /^\d+$/.test(digitos) ? digitos.replace(/^0+(?=\d)/, "") : t;
}

/** Pseudônimo de um identificador: HMAC-SHA256, nunca reversível. */
export function pseudonym(raw: string): string {
  return createHmac("sha256", chave()).update(normalizeIdentifier(raw)).digest("hex");
}

/** Matrícula como a conferência a compara: sem zeros à esquerda, sem caixa. */
export function canonicalRegistration(raw: string): string {
  const t = raw.trim().toUpperCase();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, "") : t;
}

export function accountKey(userId: string): string {
  return `acct:${userId}`;
}

export function identifierKey(raw: string): string {
  return `id:${pseudonym(raw)}`;
}

export function firstAccessKey(registration: string): string {
  return `fa:${createHmac("sha256", chave()).update(canonicalRegistration(registration)).digest("hex")}`;
}

/** O limite por IP só vale quando o servidor conhece o IP real. */
export function ipLimitEnabled(): boolean {
  return Boolean(process.env.TRUST_PROXY?.trim());
}

/**
 * O IP da conexão. Com `TRUST_PROXY`, o Express lê o `X-Forwarded-For` só
 * dos proxies configurados como confiáveis; sem ele, é o IP do socket.
 */
export function clientIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

export function ipKey(ip: string | null): string | null {
  return ipLimitEnabled() && ip ? `ip:${ip}` : null;
}

/** O bloqueio mais longo entre as chaves, se houver. */
export async function lockedUntil(keys: Array<string | null>): Promise<Date | null> {
  const validas = keys.filter((k): k is string => Boolean(k));
  if (validas.length === 0) return null;
  const agora = new Date();
  const rows = await prisma.authLockout.findMany({
    where: { key: { in: validas }, lockedUntil: { gt: agora } },
    select: { lockedUntil: true },
  });
  const ate = rows.map((r) => r.lockedUntil!.getTime());
  return ate.length ? new Date(Math.max(...ate)) : null;
}

/**
 * Soma um erro na chave, de forma atômica. Ao chegar no teto, bloqueia por
 * 15 minutos e zera a contagem. Com `windowMs`, a contagem recomeça quando a
 * janela passa (limite por IP); sem, conta erros seguidos até um acerto.
 * Devolve até quando ficou bloqueada, se bloqueou agora.
 */
export async function registerFailure(
  key: string | null,
  max: number,
  windowMs: number | null,
): Promise<Date | null> {
  if (!key) return null;
  const agora = new Date();
  const inicioDaJanela = windowMs ? new Date(agora.getTime() - windowMs) : new Date(0);
  const rows = await prisma.$queryRaw<Array<{ failures: number }>>`
    INSERT INTO "AuthLockout" ("key", "failures", "windowStart", "updatedAt")
    VALUES (${key}, 1, ${agora}, ${agora})
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE
        WHEN "AuthLockout"."windowStart" < ${inicioDaJanela} THEN 1
        ELSE "AuthLockout"."failures" + 1
      END,
      "windowStart" = CASE
        WHEN "AuthLockout"."windowStart" < ${inicioDaJanela} THEN ${agora}
        ELSE "AuthLockout"."windowStart"
      END,
      "updatedAt" = ${agora}
    RETURNING "failures"`;
  const failures = Number(rows[0]?.failures ?? 0);
  if (failures < max) return null;
  const ate = new Date(agora.getTime() + LOCK_MS);
  await prisma.authLockout.update({
    where: { key },
    data: { lockedUntil: ate, failures: 0, windowStart: agora },
  });
  return ate;
}

/** Um acerto zera os erros seguidos da chave (e o bloqueio, se houver). */
export async function clearFailures(key: string | null): Promise<void> {
  if (!key) return;
  await prisma.authLockout.deleteMany({ where: { key } });
}

/** Registra a tentativa e apaga o que passou de 90 dias. */
export async function recordAttempt(input: {
  kind: AuthAttemptKind;
  subject: string;
  userId: string | null;
  ip: string | null;
  success: boolean;
}): Promise<void> {
  await prisma.authAttempt.create({ data: input });
  const limite = new Date(Date.now() - ATTEMPT_RETENTION_DAYS * 24 * 3600_000);
  await prisma.authAttempt.deleteMany({ where: { at: { lt: limite } } });
}

export function minutesLeft(until: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
}
