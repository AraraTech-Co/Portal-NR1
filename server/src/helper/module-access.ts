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

/**
 * Módulos em que a escrita do papel é sobre o PRÓPRIO registro, não sobre o
 * dos outros.
 *
 * A matriz tem três níveis (none/read/write) e não distingue "envio o meu" de
 * "cuido do de todos". Escrever para enviar o próprio registro não pode dar
 * acesso ao dos colegas nem poder de decidir sobre eles. [S4-A] [S4-J]
 *
 * Enquanto a matriz não tiver essa dimensão, a exceção fica aqui, explícita.
 */
const SELF_SERVICE_ONLY: Record<string, readonly ModuleId[]> = {
  colaborador: ["aep", "ocorrencias", "atestados", "denuncia", "clima", "ideias"],
};

/**
 * Pode administrar o módulo — ver e decidir sobre o registro DE OUTRA PESSOA.
 * É o que separa o RH do colaborador onde os dois escrevem.
 */
export function canManageModule(roleKey: string, moduleId: ModuleId): boolean {
  if (!canWriteModule(roleKey, moduleId)) return false;
  const role = normalizeRoleKey(roleKey);
  return !(SELF_SERVICE_ONLY[role] ?? []).includes(moduleId);
}

/**
 * Papéis só de consulta: leem, nunca gravam — nem o próprio registro. O
 * bloqueio de gravação fica no `authenticate`, para valer em toda rota. [S7-A]
 */
const READ_ONLY_ROLES: readonly string[] = ["fiscal"];

export function isReadOnlyRole(roleKey: string): boolean {
  return READ_ONLY_ROLES.includes(normalizeRoleKey(roleKey));
}

/**
 * Onde a consulta vê o registro de TODOS, não só o próprio. Nos módulos de
 * pessoas, "ler" quer dizer "ler o que é meu"; a fiscalização precisa ver
 * quem fez o treinamento, quem está com exame em dia, quem deu ciência.
 */
const SEES_ALL_READ_ONLY: Record<string, readonly ModuleId[]> = {
  fiscal: ["colaboradores", "documentos_rh", "saude", "treinamentos", "convocacoes"],
};

/** Vê o registro de outras pessoas no módulo: quem administra, ou a consulta. */
export function canSeeAllInModule(roleKey: string, moduleId: ModuleId): boolean {
  if (canManageModule(roleKey, moduleId)) return true;
  const role = normalizeRoleKey(roleKey);
  return (SEES_ALL_READ_ONLY[role] ?? []).includes(moduleId);
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
