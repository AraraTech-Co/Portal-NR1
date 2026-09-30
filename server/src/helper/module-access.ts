import moduleAccess from "../../config/module-access.json";

export type AccessLevel = "none" | "read" | "write";

export type ModuleId = string;

const matrix = moduleAccess as Record<string, Record<string, AccessLevel>>;

/** Alias legado: `user` ≡ `colaborador`. */
function normalizeRoleKey(roleKey: string): string {
  if (roleKey === "user") return "colaborador";
  if (roleKey === "admin") return "gerente";
  return roleKey;
}

const LEVEL_RANK: Record<AccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
};

export function accessLevel(roleKey: string, moduleId: ModuleId): AccessLevel {
  const role = normalizeRoleKey(roleKey);
  const level = matrix[role]?.[moduleId];
  return level ?? "none";
}

export function canReadModule(roleKey: string, moduleId: ModuleId): boolean {
  return LEVEL_RANK[accessLevel(roleKey, moduleId)] >= LEVEL_RANK.read;
}

export function canWriteModule(roleKey: string, moduleId: ModuleId): boolean {
  return LEVEL_RANK[accessLevel(roleKey, moduleId)] >= LEVEL_RANK.write;
}

/** Mapa módulo → read|write (omite none) para a sessão do client. */
export function modulesForRole(
  roleKey: string,
): Record<string, "read" | "write"> {
  const role = normalizeRoleKey(roleKey);
  const row = matrix[role] ?? {};
  const out: Record<string, "read" | "write"> = {};
  for (const [moduleId, level] of Object.entries(row)) {
    if (level === "read" || level === "write") {
      out[moduleId] = level;
    }
  }
  return out;
}

export function listModuleIds(): string[] {
  const first = Object.values(matrix)[0];
  return first ? Object.keys(first) : [];
}
