import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Sector } from "../model/schema/Sector/Sector";
import { JobRole } from "../model/schema/JobRole/JobRole";
import { Activity } from "../model/schema/Activity/Activity";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { cnpjOrNull } from "../helper/cnpj";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

/** CNPJ: vazio vira null; preenchido tem de ser válido e fica só com os dígitos. */
function textOrNull(raw: string | null | undefined): string | null {
  return raw && raw.trim() !== "" ? raw.trim() : null;
}

type Impedimento = { message: string; code: string };
export type Arquivavel = "establishment" | "sector" | "job_role" | "activity";

/*
  O que impede arquivar, num lugar só: o arquivamento recusa por aqui, e a
  tela pergunta antes de pedir confirmação — quem confirmava recebia em
  seguida a notícia de que não podia. [B3-1-C]
*/
async function impedimentoDoEstabelecimento(orgId: string, id: string): Promise<Impedimento | null> {
  const sectors = await prisma.sector.count({
    where: { organizationId: orgId, establishmentId: id, archivedAt: null },
  });
  return sectors > 0
    ? {
        message: `Este estabelecimento ainda tem ${sectors} setor(es) ativo(s). Arquive os setores antes.`,
        code: "ESTABLISHMENT_HAS_SECTORS",
      }
    : null;
}

async function impedimentoDoSetor(orgId: string, id: string): Promise<Impedimento | null> {
  const activities = await prisma.activity.count({
    where: { organizationId: orgId, sectorId: id, archivedAt: null },
  });
  return activities > 0
    ? {
        message: `Este setor ainda tem ${activities} atividade(s) ativa(s). Arquive as atividades antes.`,
        code: "SECTOR_HAS_ACTIVITIES",
      }
    : null;
}

/*
  Arquivar a função não conferia nada: dava para arquivar uma função ainda
  ligada a atividade ativa — a atividade continuava na lista, sem função — e
  para arquivar a função de quem trabalha nela, deixando a ficha sem o que
  define os perigos e a ordem de serviço. [S2-G] [B2-1-H]
*/
async function impedimentoDaFuncao(orgId: string, id: string): Promise<Impedimento | null> {
  const [atividades, pessoas] = await Promise.all([
    prisma.activityJobRole.count({
      where: {
        jobRoleId: id,
        activity: { organizationId: orgId, archivedAt: null },
      },
    }),
    prisma.employeeProfile.count({
      where: { organizationId: orgId, jobRoleId: id, dismissedAt: null },
    }),
  ]);
  if (atividades > 0) {
    return {
      message: `Esta função ainda está em ${atividades} atividade(s) ativa(s). Desligue a função das atividades antes.`,
      code: "JOB_ROLE_IN_USE",
    };
  }
  if (pessoas > 0) {
    return {
      message: `${pessoas} pessoa(s) estão nesta função. Mude a função delas antes de arquivar.`,
      code: "JOB_ROLE_HAS_PEOPLE",
    };
  }
  return null;
}

async function impedimentoDaAtividade(orgId: string, id: string): Promise<Impedimento | null> {
  const hazards = await prisma.hazard.count({
    where: { organizationId: orgId, activityId: id, archivedAt: null },
  });
  return hazards > 0
    ? {
        message: `Esta atividade tem ${hazards} perigo(s) no inventário. Arquive-os antes, para o inventário não perder a origem.`,
        code: "ACTIVITY_HAS_HAZARDS",
      }
    : null;
}

const IMPEDIMENTO: Record<Arquivavel, (orgId: string, id: string) => Promise<Impedimento | null>> = {
  establishment: impedimentoDoEstabelecimento,
  sector: impedimentoDoSetor,
  job_role: impedimentoDaFuncao,
  activity: impedimentoDaAtividade,
};

/** Existe, é da empresa e ainda não foi arquivado. */
async function aindaAtivo(tipo: Arquivavel, orgId: string, id: string): Promise<boolean> {
  const where = { id, organizationId: orgId, archivedAt: null };
  const n =
    tipo === "establishment"
      ? await prisma.establishment.count({ where })
      : tipo === "sector"
        ? await prisma.sector.count({ where })
        : tipo === "job_role"
          ? await prisma.jobRole.count({ where })
          : await prisma.activity.count({ where });
  return n > 0;
}

/**
 * Mudança na operação fica na trilha: o inventário depende dela, e a
 * fiscalização pergunta quem mudou o quê. [S2-N]
 */
async function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  /*
    Salvar sem mudar nada não é mudança: registro igual polui o histórico
    que se mostra ao fiscal e esconde o que de fato aconteceu. [CB-16]
  */
  if (before !== null && JSON.stringify(before) === JSON.stringify(after)) return;
  const auth = req as AuthRequest;
  await writeAudit({
    organizationId: actorOrgId(auth),
    actorId: actorUserId(auth),
    action,
    entityType,
    entityId,
    before,
    after,
  });
}

class WorkplaceController {
  // —— Establishments ——
  async listEstablishments(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await new Establishment().read.all(
        { organizationId: orgId, archivedAt: null },
        {},
        { createdAt: "asc" },
      );
      res.json({ establishments: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createEstablishment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { name, tax_id, address } = req.body as {
        name?: string;
        tax_id?: string;
        address?: string;
      };
      if (!name?.trim()) {
        res.status(400).json({ message: "Informe o nome." });
        return;
      }
      const row = await new Establishment().create.new({
        organizationId: orgId,
        name: name.trim(),
        taxId: cnpjOrNull(tax_id),
        address: textOrNull(address),
      });
      // A data em que a unidade passou a existir é o começo do inventário:
      // sem ela, o fiscal não tem como ler a linha do tempo. [CB-15]
      await audit(req, "establishment.create", "Establishment", row.id, null, {
        name: row.name,
        taxId: row.taxId,
      });
      res.status(201).json({ establishment: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateEstablishment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const id = req.params.id;
      const existing = await new Establishment().read.one({
        id,
        organizationId: orgId,
      });
      if (!existing || existing.archivedAt) {
        res.status(404).json({ message: "Estabelecimento não encontrado." });
        return;
      }
      const { name, tax_id, address } = req.body as {
        name?: string;
        tax_id?: string | null;
        address?: string | null;
      };
      if (name !== undefined && !name.trim()) {
        res.status(400).json({ message: "O nome não pode ficar vazio." });
        return;
      }
      const row = await new Establishment().update.one(
        { id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(tax_id !== undefined ? { taxId: cnpjOrNull(tax_id) } : {}),
          ...(address !== undefined ? { address: textOrNull(address) } : {}),
        },
      );
      await audit(req, "establishment.update", "Establishment", id,
        { name: existing.name, taxId: existing.taxId, address: existing.address },
        { name: row?.name, taxId: row?.taxId, address: row?.address });
      res.json({ establishment: row });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Se dá para arquivar, sem arquivar: a tela pergunta antes de pedir
   * confirmação, e diz já o que impede. [B3-1-C]
   */
  canArchive(tipo: Arquivavel) {
    return async (req: Request, res: Response) => {
      try {
        const orgId = actorOrgId(req as AuthRequest);
        if (!(await aindaAtivo(tipo, orgId, req.params.id))) {
          res.status(404).json({ message: "Não encontrado." });
          return;
        }
        const impedimento = await IMPEDIMENTO[tipo](orgId, req.params.id);
        res.json(impedimento ? { can_archive: false, ...impedimento } : { can_archive: true });
      } catch (err) {
        fail(res, err);
      }
    };
  }

  async archiveEstablishment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const id = req.params.id;
      const impedimento = await impedimentoDoEstabelecimento(orgId, id);
      if (impedimento) {
        res.status(409).json(impedimento);
        return;
      }
      const row = await new Establishment().update.one(
        { id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Estabelecimento não encontrado." });
        return;
      }
      await audit(req, "establishment.archive", "Establishment", id, null, { archivedAt: row.archivedAt });
      res.json({ establishment: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Sectors ——
  async listSectors(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const query: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (establishmentId) query.establishmentId = establishmentId;
      const rows = await new Sector().read.all(query, {}, { createdAt: "asc" });
      res.json({ sectors: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createSector(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const {
        establishment_id,
        name,
        description,
        process_description,
        environment_description,
      } = req.body as Record<string, string | undefined>;
      if (!establishment_id || !name?.trim()) {
        res.status(400).json({ message: "Informe establishment_id e name." });
        return;
      }
      const est = await new Establishment().read.one({
        id: establishment_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!est) {
        res.status(400).json({ message: "Estabelecimento inválido." });
        return;
      }
      const row = await new Sector().create.new({
        organizationId: orgId,
        establishmentId: establishment_id,
        name: name.trim(),
        description: description ?? null,
        processDescription: process_description ?? null,
        environmentDescription: environment_description ?? null,
      });
      await audit(req, "sector.create", "Sector", row.id, null, { name: row.name });
      res.status(201).json({ sector: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateSector(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const id = req.params.id;
      const existing = await new Sector().read.one({
        id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Setor não encontrado." });
        return;
      }
      const body = req.body as Record<string, string | undefined>;
      if (body.name !== undefined && !body.name.trim()) {
        res.status(400).json({ message: "O nome não pode ficar vazio." });
        return;
      }
      const row = await new Sector().update.one(
        { id, organizationId: orgId },
        {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.process_description !== undefined
            ? { processDescription: body.process_description }
            : {}),
          ...(body.environment_description !== undefined
            ? { environmentDescription: body.environment_description }
            : {}),
        },
      );
      await audit(req, "sector.update", "Sector", id,
        { name: existing.name, description: existing.description },
        { name: row?.name, description: row?.description });
      res.json({ sector: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveSector(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const impedimento = await impedimentoDoSetor(orgId, req.params.id);
      if (impedimento) {
        res.status(409).json(impedimento);
        return;
      }
      const row = await new Sector().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Setor não encontrado." });
        return;
      }
      await audit(req, "sector.archive", "Sector", row.id, null, { archivedAt: row.archivedAt });
      res.json({ sector: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Job roles ——
  async listJobRoles(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const sectorId = req.query.sector_id as string | undefined;
      const query: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (sectorId) query.sectorId = sectorId;
      /*
        A função vem com a unidade: sem isso, a planilha casava pelo nome em
        toda a empresa e podia ligar a pessoa à unidade errada. [CB-6]
      */
      const rows = await prisma.jobRole.findMany({
        where: query as never,
        /*
          A ordem é a que a empresa escolheu: a função nova entra no fim, e
          `position` deixa aproximar as parecidas. [S1-I]
        */
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: {
          sector: {
            select: {
              id: true,
              name: true,
              establishment: { select: { id: true, name: true } },
            },
          },
        },
      });
      res.json({
        job_roles: rows.map((r) => ({
          ...r,
          sector_name: r.sector.name,
          establishment: r.sector.establishment,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createJobRole(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { sector_id, name, description } = req.body as {
        sector_id?: string;
        name?: string;
        description?: string;
      };
      if (!sector_id || !name?.trim()) {
        res.status(400).json({ message: "Informe sector_id e name." });
        return;
      }
      const sector = await new Sector().read.one({
        id: sector_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!sector) {
        res.status(400).json({ message: "Setor inválido." });
        return;
      }
      const ultima = await prisma.jobRole.aggregate({
        where: { organizationId: orgId, sectorId: sector_id, archivedAt: null },
        _max: { position: true },
      });
      const row = await new JobRole().create.new({
        organizationId: orgId,
        sectorId: sector_id,
        name: name.trim(),
        description: description ?? null,
        position: (ultima._max.position ?? -1) + 1,
      });
      await audit(req, "job_role.create", "JobRole", row.id, null, { name: row.name });
      res.status(201).json({ job_role: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateJobRole(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const existing = await new JobRole().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Função não encontrada." });
        return;
      }
      const { name, description } = req.body as {
        name?: string;
        description?: string | null;
      };
      if (name !== undefined && !name.trim()) {
        res.status(400).json({ message: "O nome não pode ficar vazio." });
        return;
      }
      const row = await new JobRole().update.one(
        { id: req.params.id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      );
      await audit(req, "job_role.update", "JobRole", existing.id,
        { name: existing.name, description: existing.description },
        { name: row?.name, description: row?.description });
      res.json({ job_role: row });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Trocar a função de lugar na lista do setor. A ordem era a de criação e
   * não havia como mudá-la, então função parecida ficava longe da outra.
   * [S1-I]
   */
  async moveJobRole(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const para = (req.body as { para?: string }).para;
      if (para !== "cima" && para !== "baixo") {
        res.status(400).json({ message: 'Informe para: "cima" ou "baixo".' });
        return;
      }

      const alvo = await prisma.jobRole.findFirst({
        where: { id: req.params.id, organizationId: orgId, archivedAt: null },
        select: { id: true, sectorId: true, name: true },
      });
      if (!alvo) {
        res.status(404).json({ message: "Função não encontrada." });
        return;
      }

      const job_roles = await prisma.$transaction(async (tx) => {
        const irmas = await tx.jobRole.findMany({
          where: {
            organizationId: orgId,
            sectorId: alvo.sectorId,
            archivedAt: null,
          },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: { id: true },
        });
        const de = irmas.findIndex((j) => j.id === alvo.id);
        const ate = para === "cima" ? de - 1 : de + 1;
        if (de < 0 || ate < 0 || ate >= irmas.length) {
          // Já está na ponta: nada a trocar, e não é erro.
          return irmas.map((j) => j.id);
        }
        const nova = irmas.map((j) => j.id);
        [nova[de], nova[ate]] = [nova[ate], nova[de]];
        /*
          Grava a sequência inteira, não só as duas trocadas: antes desta
          coluna todas valiam 0, e empate deixaria a ordem por criação de
          novo.
        */
        for (const [i, id] of nova.entries()) {
          await tx.jobRole.update({ where: { id }, data: { position: i } });
        }
        return nova;
      });

      await audit(req, "job_role.reorder", "JobRole", alvo.id, null, {
        para,
        name: alvo.name,
      });
      res.json({ job_role_ids: job_roles });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveJobRole(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const impedimento = await impedimentoDaFuncao(orgId, req.params.id);
      if (impedimento) {
        res.status(409).json(impedimento);
        return;
      }

      const row = await new JobRole().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Função não encontrada." });
        return;
      }
      await audit(req, "job_role.archive", "JobRole", row.id, null, { archivedAt: row.archivedAt });
      res.json({ job_role: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Activities ——
  async listActivities(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const sectorId = req.query.sector_id as string | undefined;
      const query: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (sectorId) query.sectorId = sectorId;
      const rows = await prisma.activity.findMany({
        where: query as never,
        include: {
          jobRoles: { include: { jobRole: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      /*
        Quantas pessoas estão nas funções desta atividade. O número de
        expostos era digitado, e o portal já sabia a resposta: pedir à mão é
        pedir número errado. A tela sugere isto e deixa corrigir, porque pode
        haver exposto de outra área. [CB-22]
      */
      const funcoesPorAtividade = new Map<string, string[]>();
      for (const a of rows) {
        funcoesPorAtividade.set(
          a.id,
          a.jobRoles.map((j) => j.jobRoleId),
        );
      }
      const todasFuncoes = [
        ...new Set([...funcoesPorAtividade.values()].flat()),
      ];
      const porFuncao = new Map<string, number>();
      if (todasFuncoes.length > 0) {
        const contagens = await prisma.employeeProfile.groupBy({
          by: ["jobRoleId"],
          where: {
            organizationId: orgId,
            jobRoleId: { in: todasFuncoes },
            dismissedAt: null,
          },
          _count: { _all: true },
        });
        for (const c of contagens) {
          if (c.jobRoleId) porFuncao.set(c.jobRoleId, c._count._all);
        }
      }

      res.json({
        activities: rows.map((a) => {
          const ids = funcoesPorAtividade.get(a.id) ?? [];
          return {
            ...a,
            job_role_ids: ids,
            people_count: ids.reduce(
              (total, id) => total + (porFuncao.get(id) ?? 0),
              0,
            ),
          };
        }),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createActivity(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { establishment_id, sector_id, name, description, job_role_ids } =
        req.body as {
          establishment_id?: string;
          sector_id?: string;
          name?: string;
          description?: string;
          job_role_ids?: string[];
        };
      if (!establishment_id || !sector_id || !name?.trim()) {
        res.status(400).json({
          message: "Informe establishment_id, sector_id e name.",
        });
        return;
      }
      // É da descrição da atividade que sai o perigo. [S1-J]
      if (!description?.trim()) {
        res.status(400).json({ message: "Descreva a atividade: o que a pessoa faz, com o quê e onde." });
        return;
      }
      const sector = await new Sector().read.one({
        id: sector_id,
        organizationId: orgId,
        establishmentId: establishment_id,
        archivedAt: null,
      });
      if (!sector) {
        res.status(400).json({ message: "Setor/estabelecimento inválidos." });
        return;
      }
      const row = await new Activity().create.new({
        organizationId: orgId,
        establishmentId: establishment_id,
        sectorId: sector_id,
        name: name.trim(),
        description: description.trim(),
      });
      if (job_role_ids?.length) {
        for (const jobRoleId of job_role_ids) {
          const jr = await new JobRole().read.one({
            id: jobRoleId,
            organizationId: orgId,
            archivedAt: null,
          });
          if (!jr) continue;
          await prisma.activityJobRole.create({
            data: { activityId: row.id, jobRoleId },
          });
        }
      }
      await audit(req, "activity.create", "Activity", row.id, null, { name: row.name });
      res.status(201).json({ activity: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateActivity(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const existing = await new Activity().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Atividade não encontrada." });
        return;
      }
      const { name, description, job_role_ids } = req.body as {
        name?: string;
        description?: string | null;
        job_role_ids?: string[];
      };
      if (name !== undefined && !name.trim()) {
        res.status(400).json({ message: "O nome não pode ficar vazio." });
        return;
      }
      if (description !== undefined && !description?.trim()) {
        res.status(400).json({ message: "Descreva a atividade: o que a pessoa faz, com o quê e onde." });
        return;
      }
      const row = await new Activity().update.one(
        { id: req.params.id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description ? { description: description.trim() } : {}),
        },
      );
      await audit(req, "activity.update", "Activity", existing.id,
        { name: existing.name, description: existing.description },
        { name: row?.name, description: row?.description, ...(job_role_ids ? { job_role_ids } : {}) });
      if (job_role_ids) {
        await prisma.activityJobRole.deleteMany({
          where: { activityId: req.params.id },
        });
        for (const jobRoleId of job_role_ids) {
          const jr = await new JobRole().read.one({
            id: jobRoleId,
            organizationId: orgId,
            archivedAt: null,
          });
          if (!jr) continue;
          await prisma.activityJobRole.create({
            data: { activityId: req.params.id, jobRoleId },
          });
        }
      }
      res.json({ activity: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveActivity(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const impedimento = await impedimentoDaAtividade(orgId, req.params.id);
      if (impedimento) {
        res.status(409).json(impedimento);
        return;
      }
      const row = await new Activity().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Atividade não encontrada." });
        return;
      }
      await audit(req, "activity.archive", "Activity", row.id, null, { archivedAt: row.archivedAt });
      res.json({ activity: row });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new WorkplaceController();
