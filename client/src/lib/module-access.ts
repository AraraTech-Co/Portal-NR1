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

/**
 * Desligar e alterar CPF ou matrícula — espelho do servidor
 * (`PERSONNEL_RECORD_ROLES`). Escrever em Colaboradores não dá esses dois
 * poderes. [OB-8]
 */
const PERSONNEL_RECORD_ROLES: readonly string[] = ["master", "owner", "rh"];

export function canChangePersonnelRecord(
  permission: string | undefined,
): boolean {
  return PERSONNEL_RECORD_ROLES.includes(
    permission === "user" ? "colaborador" : (permission ?? ""),
  );
}

/**
 * Encerrar a análise da ocorrência — espelho do servidor
 * (`OCCURRENCE_ANALYSIS_ROLES`). Quem está no fato relata; quem responde
 * tecnicamente analisa e encerra. [S3-E]
 */
const OCCURRENCE_ANALYSIS_ROLES: readonly string[] = ["master", "owner", "sst"];

export function canCloseOccurrenceAnalysis(
  permission: string | undefined,
): boolean {
  return OCCURRENCE_ANALYSIS_ROLES.includes(
    permission === "user" ? "colaborador" : (permission ?? ""),
  );
}
