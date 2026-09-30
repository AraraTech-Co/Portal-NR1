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

/** Hook: nível do módulo na sessão atual. */
export function useModuleAccess(moduleId: string) {
  const { user } = useAuth();
  const level = moduleLevel(user?.modules, moduleId);
  return {
    level,
    canRead: level === "read" || level === "write",
    canWrite: level === "write",
  };
}
