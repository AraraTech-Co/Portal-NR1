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

/**
 * A tela do módulo abre: pela matriz, ou pela consulta própria (ver só o que
 * é seu). Menu e rota usam isto; escrever continua pela matriz. [C2-1]
 */
export function canOpenModule(
  user: { modules?: Record<string, ModuleAccessLevel>; own_modules?: string[] } | null | undefined,
  moduleId: string,
): boolean {
  return canReadModule(user?.modules, moduleId) || (user?.own_modules ?? []).includes(moduleId);
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

/**
 * Módulos dos quais este papel cuida — grava e não é só o próprio registro.
 * O Início era igual para todos e não dizia o que era do papel de quem
 * entrou. [S2-I]
 */
export function managedModules(
  modules: Record<string, ModuleAccessLevel> | undefined,
  permission: string | undefined,
): string[] {
  const papel = permission === "user" ? "colaborador" : (permission ?? "");
  const proprios = [
    ...(SELF_SERVICE_ONLY[papel] ?? []),
    /*
      Todo papel grava em "denuncia" — é fazer a sua própria denúncia, não
      cuidar do canal. Quem cuida do canal é o comitê, que é outro módulo.
    */
    "denuncia",
  ];
  return Object.entries(modules ?? {})
    .filter(([id, level]) => level === "write" && !proprios.includes(id))
    .map(([id]) => id);
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

/**
 * Validar a ação — espelho do servidor (`ACTION_VALIDATION_ROLES`). A tela
 * mostrava "Aprovar" e "Recusar evidência" a qualquer um com escrita no
 * plano, e um supervisor validava a ação de outro supervisor. [OB-6]
 */
const ACTION_VALIDATION_ROLES: readonly string[] = ["master", "owner", "sst"];

export function canValidateAction(permission: string | undefined): boolean {
  return ACTION_VALIDATION_ROLES.includes(
    permission === "user" ? "colaborador" : (permission ?? ""),
  );
}

/**
 * Copiar setores, funções, atividades, perigos, riscos e medidas de uma
 * filial para outra: o SST e o Master (resposta C, 10/11). O Dono não. [C3-8]
 */
const UNIT_COPY_ROLES: readonly string[] = ["master", "sst"];

export function canCopyBetweenUnits(permission: string | undefined): boolean {
  return UNIT_COPY_ROLES.includes(permission ?? "");
}

/** Painel da fiscalização — espelho do servidor (`INSPECTION_PANEL_ROLES`). [C4-13] */
const INSPECTION_PANEL_ROLES: readonly string[] = ["master", "owner", "sst", "rh", "fiscal"];

export function canSeeInspectionPanel(permission: string | undefined): boolean {
  return INSPECTION_PANEL_ROLES.includes(permission === "user" ? "colaborador" : (permission ?? ""));
}
