import { randomInt } from "crypto";

/** Sem 0/O, 1/l/I: a senha vai ser ditada ou digitada à mão. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Senha de primeiro acesso: mostrada uma vez, trocada na entrada. [S1-D] */
export function temporaryPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
