import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canManagePayrollData, canReadPayrollData } from "../helper/module-access";
import {
  DadoDaFolhaInvalido,
  camposQueMudam,
  dadosDaFolhaParaApi,
  lerDadosDaFolha,
} from "../helper/dados-da-folha";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/**
 * Os dados da planilha da folha na ficha. [PF-2]
 *
 * Quem não pode ler recebe o mesmo 404 de ficha que não existe: a resposta
 * não diz se a pessoa tem dados guardados.
 */
class EmployeePayrollDataController {
  private async ficha(req: Request) {
    const auth = req as AuthRequest;
    const orgId = actorOrgId(auth);
    const profile = await prisma.employeeProfile.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      select: { id: true, userId: true, payrollData: true },
    });
    if (!profile || !canReadPayrollData(auth.actor!, profile)) return null;
    return { orgId, actor: auth.actor!, profile };
  }

  async get(req: Request, res: Response) {
    try {
      const achado = await this.ficha(req);
      if (!achado) {
        res.status(404).json({ message: "Ficha não encontrada." });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({
        dados: dadosDaFolhaParaApi(achado.profile.payrollData),
        pode_editar: canManagePayrollData(achado.actor.permission),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Só Master, Dono e RH; a própria pessoa lê, mas não edita. */
  async update(req: Request, res: Response) {
    try {
      const achado = await this.ficha(req);
      if (!achado) {
        res.status(404).json({ message: "Ficha não encontrada." });
        return;
      }
      if (!canManagePayrollData(achado.actor.permission)) {
        res.status(403).json({ message: "Só o RH altera os dados da folha." });
        return;
      }
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      /* A competência diz de que folha veio o dado; à mão, ela não muda. */
      const { competence: _ignorada, ...semCompetencia } = corpo;
      const novos = lerDadosDaFolha(semCompetencia);
      const mudou = camposQueMudam(achado.profile.payrollData, novos);
      if (mudou.length === 0) {
        res.json({ dados: dadosDaFolhaParaApi(achado.profile.payrollData), mudou: [] });
        return;
      }
      const linha = await prisma.employeePayrollData.upsert({
        where: { profileId: achado.profile.id },
        create: {
          organizationId: achado.orgId,
          profileId: achado.profile.id,
          ...novos,
          updatedById: achado.actor.userId,
        },
        update: { ...novos, updatedById: achado.actor.userId },
      });
      /* A trilha diz o que mudou e quem mudou, sem os valores. */
      await writeAudit({
        organizationId: achado.orgId,
        actorId: achado.actor.userId,
        action: "employee_payroll_data.update",
        entityType: "EmployeeProfile",
        entityId: achado.profile.id,
        after: { via: "manual", fields: mudou },
      });
      res.json({ dados: dadosDaFolhaParaApi(linha), mudou });
    } catch (err) {
      if (err instanceof DadoDaFolhaInvalido) {
        res.status(400).json({ message: err.message });
        return;
      }
      fail(res, err);
    }
  }
}

export default new EmployeePayrollDataController();
