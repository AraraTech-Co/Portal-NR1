import { verifyModule } from "../../model/lib/Auth";

/** Leitura (L ou L/E) no módulo. */
export function moduleRead(moduleId: string) {
  return verifyModule(moduleId, "read");
}

/** Escrita (L/E) no módulo. */
export function moduleWrite(moduleId: string) {
  return verifyModule(moduleId, "write");
}

/**
 * Administrar o módulo: decidir sobre o registro de outra pessoa.
 * Escrita não basta — o colaborador escreve para registrar a PRÓPRIA
 * ocorrência ou avaliação.
 */
export function moduleManage(moduleId: string) {
  return verifyModule(moduleId, "manage");
}
