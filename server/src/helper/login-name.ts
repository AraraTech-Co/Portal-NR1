/**
 * Login curto e único. O portal entra por login, não por e-mail: metade de
 * quem trabalha em loja não tem e-mail corporativo. [S1-A]
 */

/** Tira acento e o que não serve num login. */
function slug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\-_]+|[.\-_]+$/g, "");
}

export function loginCandidateFromEmail(email: string): string {
  const local = slug(email.split("@")[0] ?? "");
  return local.slice(0, 40) || "user";
}

/** "José da Silva Souza" → "jose.souza" (primeiro e último nome). */
export function loginCandidateFromName(name: string): string {
  const partes = slug(name).split(".").filter(Boolean);
  if (partes.length === 0) return "pessoa";
  const base =
    partes.length === 1 ? partes[0]! : `${partes[0]}.${partes[partes.length - 1]}`;
  return base.slice(0, 40) || "pessoa";
}

type UserLookup = {
  user: {
    findUnique: (args: { where: { login: string } }) => Promise<{ id: string } | null>;
  };
};

/** Primeiro livre a partir da base: `jose.souza`, `jose.souza-2`, … */
export async function allocateUniqueLogin(
  base: string,
  tx: UserLookup,
): Promise<string> {
  let candidate = base;
  for (let i = 0; i < 50; i += 1) {
    const exists = await tx.user.findUnique({ where: { login: candidate } });
    if (!exists) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}
