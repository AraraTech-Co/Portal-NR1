import { verifyModule } from "../../model/lib/Auth";

/** Leitura (L ou L/E) no módulo. */
export function moduleRead(moduleId: string) {
  return verifyModule(moduleId, "read");
}

/** Escrita (L/E) no módulo. */
export function moduleWrite(moduleId: string) {
  return verifyModule(moduleId, "write");
}
