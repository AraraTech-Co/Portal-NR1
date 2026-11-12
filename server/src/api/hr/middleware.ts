import type { NextFunction, Request, Response } from "express";
import { verifyModule } from "../../model/lib/Auth";
import { canChangePersonnelRecord } from "../../helper/module-access";
import type { AuthRequest } from "../../types/auth";

/** Leitura (L ou L/E) no módulo. */
export function moduleRead(moduleId: string) {
  return verifyModule(moduleId, "read");
}

/**
 * Consulta própria: leitura no módulo, ou ficha ativa para ver só o que é
 * seu. Só em GET; o controlador filtra pela titularidade. [C2-1]
 */
export function moduleOwn(moduleId: string) {
  return verifyModule(moduleId, "own");
}

/** Enviar o próprio registro, com ficha ativa, qualquer papel menos o fiscal. [C4-4] */
export function moduleOwnSend(moduleId: string) {
  return verifyModule(moduleId, "ownSend");
}

/** Escrita (L/E) no módulo. */
export function moduleWrite(moduleId: string) {
  return verifyModule(moduleId, "write");
}

/**
 * Administrar o módulo: decidir sobre o registro de outra pessoa.
 * Escrita não basta — o colaborador escreve para enviar o PRÓPRIO atestado.
 */
export function moduleManage(moduleId: string) {
  return verifyModule(moduleId, "manage");
}

/**
 * Desligar alguém e alterar CPF ou matrícula. Escrever em Colaboradores não
 * basta: desligamento corta o acesso na hora, e CPF e matrícula são a
 * identidade da pessoa no portal. Usar depois de `moduleWrite`. [OB-8]
 */
export function exigeQuadroDePessoal(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const actor = (req as AuthRequest).actor;
  if (!actor || !canChangePersonnelRecord(actor.permission)) {
    res.status(403).json({
      message: "Desligamento e alteração de CPF ou matrícula são do RH.",
      code: "PERSONNEL_RECORD_ONLY",
    });
    return;
  }
  next();
}
