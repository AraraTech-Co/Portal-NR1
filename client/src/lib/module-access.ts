import { useAuth } from "@/auth/AuthContext";
import type { ModuleAccessLevel } from "@/api/auth";

export function moduleLevel(
  modules: Record<string, ModuleAccessLevel> | undefined,
  moduleId: string,
): ModuleAccessLevel | "none" {
  return modules?.[moduleId] ?? "none";
}

export function canReadModule(
  modules: Record<string, ModuleAccessLevel> | undefined,
  moduleId: string,
): boolean {
  const level = moduleLevel(modules, moduleId);
  return level === "read" || level === "write";
}

export function canWriteModule(
  modules: Record<string, ModuleAccessLevel> | undefined,
  moduleId: string,
): boolean {
  return moduleLevel(modules, moduleId) === "write";
}

/**
 * Onde a escrita do papel é só sobre o PRÓPRIO registro — espelho do
 * servidor (`SELF_SERVICE_ONLY`). Escrever para enviar o seu atestado não é
 * cuidar do atestado dos outros. [S4-A]
 */
const SELF_SERVICE_ONLY: Record<string, readonly string[]> = {
  colaborador: ["aep", "ocorrencias", "atestados", "denuncia", "clima", "ideias"],
};

/** Hook: nível do módulo na sessão atual. */
export function useModuleAccess(moduleId: string) {
  const { user } = useAuth();
  const level = moduleLevel(user?.modules, moduleId);
  const permission = user?.permission === "user" ? "colaborador" : user?.permission ?? "";
  const canWrite = level === "write";
  return {
    level,
    canRead: level === "read" || level === "write",
    canWrite,
    /** Cuida do registro de outras pessoas (decide, vê o de todos). */
    canManage: canWrite && !(SELF_SERVICE_ONLY[permission] ?? []).includes(moduleId),
  };
}

/** Papel só de consulta (fiscal): lê, nunca grava. */
export function isReadOnlyPermission(permission: string | undefined): boolean {
  return permission === "fiscal";
}
