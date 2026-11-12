import { randomUUID } from "crypto";
import { AssessmentStatus, ControlStatus, NotificationKind, Prisma } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canCopyBetweenUnits } from "../helper/module-access";
import { notifyMany } from "../helper/notify";
import type { AuthRequest } from "../types/auth";

/**
 * Cópia entre filiais. [C3-8]
 *
 * É uma cópia, não um espelho: depois dela, cada filial segue sozinha. Leva
 * setores, funções (com as exigências de treinamento), atividades (com o
 * vínculo atividade-função), perigos, riscos, medidas e a avaliação vigente
 * de cada risco. Não leva o que está arquivado na origem, nem plano de ação,
 * PGR, AEP, pessoas, ocorrências ou registros.
 *
 * Cada item copiado guarda `copiedFromId` e `copiedAt`. Copiar de novo:
 * - o item que falta no destino é criado;
 * - o item que o destino não mexeu desde a cópia (`updatedAt` igual a
 *   `copiedAt`) recebe o conteúdo atual da origem;
 * - o item que o destino mexeu e cujo conteúdo difere é um CONFLITO: a
 *   prévia mostra a diferença, e só é sobrescrito se quem copia aceitar.
 *
 * A cópia leva o conteúdo; o estado de cada filial não é sobrescrito (a
 * situação da medida, o autor do perigo, o arquivamento no destino). A
 * avaliação é imutável: chega "em revisão" e é validada por quem não copiou.
 *
 * O banco recusa a segunda cópia do mesmo item no mesmo lugar (índice único
 * pai + copiedFromId): duas cópias ao mesmo tempo dão 409, e a transação
 * inteira volta.
 */

const TIMEOUT_MS = 60_000;

/** Os campos de conteúdo de cada nível: o que a cópia leva e atualiza. */
const CONTEUDO = {
  setores: ["name", "description", "processDescription", "environmentDescription"],
  funcoes: ["name", "description", "position", "cbo2002", "cbo94"],
  atividades: ["name", "description"],
  perigos: [
    "description",
    "source",
    "consequences",
    "exposedGroup",
    "exposedWorkersCount",
    "exposureTime",
    "exposureFrequency",
    "exposureIntensity",
    "monitoringData",
    "category",
    "status",
    "origin",
  ],
  riscos: ["description"],
  medidas: ["type", "description"],
  exigencias: ["kind", "name", "description", "trainingId", "validityMonths"],
} as const;

type NivelComConteudo = keyof typeof CONTEUDO;
export const NIVEIS = [
  "setores",
  "funcoes",
  "atividades",
  "vinculos",
  "perigos",
  "riscos",
  "medidas",
  "avaliacoes",
  "exigencias",
] as const;
type Nivel = (typeof NIVEIS)[number];

type Linha = Record<string, unknown> & { id: string };
type Copiada = Linha & { copiedFromId: string | null; copiedAt: Date | null; updatedAt: Date };

export type Conflito = {
  nivel: NivelComConteudo;
  /** O item do destino. */
  id: string;
  nome: string;
  campos: { campo: string; destino: unknown; origem: unknown }[];
};

type PlanoNivel = {
  /** Itens da origem que não existem no destino. */
  criar: Linha[];
  /** [origem, destino]: o destino não mexeu e a origem mudou. */
  atualizar: [Linha, Copiada][];
  conflitos: [Linha, Copiada, Conflito][];
  iguais: number;
};

type Db = Prisma.TransactionClient;

function mesmo(a: unknown, b: unknown): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function nomeDe(nivel: NivelComConteudo, l: Linha): string {
  return String(l.name ?? l.description ?? "");
}

function conteudo(nivel: NivelComConteudo, l: Linha): Record<string, unknown> {
  return Object.fromEntries(CONTEUDO[nivel].map((c) => [c, l[c] ?? null]));
}

/** O destino mexeu no item depois da cópia. */
function mexido(d: Copiada): boolean {
  return d.copiedAt === null || d.updatedAt.getTime() > d.copiedAt.getTime();
}

/**
 * Compara cada item da origem com a cópia dele no destino (achada pelo pai
 * já mapeado e pelo `copiedFromId`).
 */
function planejarNivel(
  nivel: NivelComConteudo,
  origem: Linha[],
  destino: Copiada[],
  chaveDaOrigem: (o: Linha) => string | null,
  chaveDoDestino: (d: Copiada) => string,
): PlanoNivel & { mapa: Map<string, string> } {
  const porChave = new Map(destino.map((d) => [chaveDoDestino(d), d]));
  const plano: PlanoNivel & { mapa: Map<string, string> } = {
    criar: [],
    atualizar: [],
    conflitos: [],
    iguais: 0,
    mapa: new Map(),
  };
  for (const o of origem) {
    const chave = chaveDaOrigem(o);
    const d = chave ? porChave.get(chave) : undefined;
    if (!d) {
      plano.criar.push(o);
      continue;
    }
    plano.mapa.set(o.id, d.id);
    const campos = CONTEUDO[nivel]
      .filter((c) => !mesmo(o[c], d[c]))
      .map((c) => ({ campo: c, destino: d[c] ?? null, origem: o[c] ?? null }));
    if (!campos.length) {
      plano.iguais++;
    } else if (mexido(d)) {
      plano.conflitos.push([o, d, { nivel, id: d.id, nome: nomeDe(nivel, d), campos }]);
    } else {
      plano.atualizar.push([o, d]);
    }
  }
  return plano;
}

const vazio = (): PlanoNivel => ({ criar: [], atualizar: [], conflitos: [], iguais: 0 });

/**
 * O plano da cópia, nível a nível. Os ids novos são gerados aqui, para que
 * o filho saiba o id do pai antes de o pai existir (`createMany` por nível).
 */
async function planejar(db: Db, origemId: string, destinoId: string) {
  const ativo = { archivedAt: null } as const;
  const copia = { copiedFromId: true, copiedAt: true, updatedAt: true } as const;
  const novoId = new Map<string, string>();
  const idNoDestino = (origem: string | null | undefined): string | undefined =>
    origem ? novoId.get(origem) : undefined;

  /* Setores. */
  const setoresO = await db.sector.findMany({ where: { establishmentId: origemId, ...ativo }, orderBy: { createdAt: "asc" } });
  const setoresD = await db.sector.findMany({
    where: { establishmentId: destinoId, copiedFromId: { in: setoresO.map((s) => s.id) } },
  });
  const setores = planejarNivel("setores", setoresO, setoresD as Copiada[], (o) => o.id, (d) => d.copiedFromId!);
  for (const o of setoresO) novoId.set(o.id, setores.mapa.get(o.id) ?? randomUUID());

  /* Funções, pelo setor. */
  const funcoesO = await db.jobRole.findMany({
    where: { sectorId: { in: setoresO.map((s) => s.id) }, ...ativo },
    orderBy: { createdAt: "asc" },
  });
  const funcoesD = await db.jobRole.findMany({
    where: { sector: { establishmentId: destinoId }, copiedFromId: { in: funcoesO.map((f) => f.id) } },
  });
  const funcoes = planejarNivel(
    "funcoes",
    funcoesO,
    funcoesD as Copiada[],
    (o) => `${idNoDestino(o.sectorId as string)}:${o.id}`,
    (d) => `${d.sectorId}:${d.copiedFromId}`,
  );
  for (const o of funcoesO) novoId.set(o.id, funcoes.mapa.get(o.id) ?? randomUUID());

  /* Atividades, pelo setor. */
  const atividadesO = await db.activity.findMany({
    where: { establishmentId: origemId, sectorId: { in: setoresO.map((s) => s.id) }, ...ativo },
    orderBy: { createdAt: "asc" },
  });
  const atividadesD = await db.activity.findMany({
    where: { establishmentId: destinoId, copiedFromId: { in: atividadesO.map((a) => a.id) } },
  });
  const atividades = planejarNivel(
    "atividades",
    atividadesO,
    atividadesD as Copiada[],
    (o) => `${idNoDestino(o.sectorId as string)}:${o.id}`,
    (d) => `${d.sectorId}:${d.copiedFromId}`,
  );
  for (const o of atividadesO) novoId.set(o.id, atividades.mapa.get(o.id) ?? randomUUID());

  /* Vínculo atividade-função: os que faltam, entre itens copiados. */
  const vinculosO = await db.activityJobRole.findMany({
    where: {
      activityId: { in: atividadesO.map((a) => a.id) },
      jobRoleId: { in: funcoesO.map((f) => f.id) },
    },
  });
  const vinculosD = await db.activityJobRole.findMany({
    where: { activityId: { in: vinculosO.map((v) => idNoDestino(v.activityId)!).filter(Boolean) } },
  });
  const jaHa = new Set(vinculosD.map((v) => `${v.activityId}:${v.jobRoleId}`));
  const vinculos = vinculosO
    .map((v) => ({ activityId: idNoDestino(v.activityId)!, jobRoleId: idNoDestino(v.jobRoleId)! }))
    .filter((v) => !jaHa.has(`${v.activityId}:${v.jobRoleId}`));

  /* Perigos, pela atividade. */
  const perigosO = await db.hazard.findMany({
    where: { activityId: { in: atividadesO.map((a) => a.id) }, ...ativo },
    orderBy: { createdAt: "asc" },
  });
  const perigosD = await db.hazard.findMany({
    where: { activity: { establishmentId: destinoId }, copiedFromId: { in: perigosO.map((p) => p.id) } },
  });
  const perigos = planejarNivel(
    "perigos",
    perigosO,
    perigosD as Copiada[],
    (o) => `${idNoDestino(o.activityId as string)}:${o.id}`,
    (d) => `${d.activityId}:${d.copiedFromId}`,
  );
  for (const o of perigosO) novoId.set(o.id, perigos.mapa.get(o.id) ?? randomUUID());

  /* Riscos, pelo perigo. */
  const riscosO = await db.risk.findMany({
    where: { hazardId: { in: perigosO.map((p) => p.id) }, ...ativo },
    orderBy: { createdAt: "asc" },
  });
  const riscosD = await db.risk.findMany({
    where: { hazard: { activity: { establishmentId: destinoId } }, copiedFromId: { in: riscosO.map((r) => r.id) } },
  });
  const riscos = planejarNivel(
    "riscos",
    riscosO,
    riscosD as Copiada[],
    (o) => `${idNoDestino(o.hazardId as string)}:${o.id}`,
    (d) => `${d.hazardId}:${d.copiedFromId}`,
  );
  for (const o of riscosO) novoId.set(o.id, riscos.mapa.get(o.id) ?? randomUUID());

  /* Medidas, pelo risco. */
  const medidasO = await db.controlMeasure.findMany({
    where: { riskId: { in: riscosO.map((r) => r.id) }, ...ativo },
    orderBy: { createdAt: "asc" },
  });
  const medidasD = await db.controlMeasure.findMany({
    where: {
      risk: { hazard: { activity: { establishmentId: destinoId } } },
      copiedFromId: { in: medidasO.map((m) => m.id) },
    },
  });
  const medidas = planejarNivel(
    "medidas",
    medidasO,
    medidasD as Copiada[],
    (o) => `${idNoDestino(o.riskId as string)}:${o.id}`,
    (d) => `${d.riskId}:${d.copiedFromId}`,
  );

  /*
    Avaliação: só a vigente de cada risco — a validada e não substituída;
    sem validada, a mais recente que não foi substituída. É imutável: se o
    destino já tem a cópia dela, nada a fazer.
  */
  const avaliacoesO = await db.riskAssessment.findMany({
    where: { riskId: { in: riscosO.map((r) => r.id) }, status: { not: AssessmentStatus.SUPERSEDED } },
    orderBy: [{ assessedAt: "desc" }, { createdAt: "desc" }],
  });
  const vigente = new Map<string, (typeof avaliacoesO)[number]>();
  for (const a of avaliacoesO) {
    const atual = vigente.get(a.riskId);
    if (!atual || (a.status === AssessmentStatus.VALIDATED && atual.status !== AssessmentStatus.VALIDATED)) {
      vigente.set(a.riskId, a);
    }
  }
  const avaliacoesD = await db.riskAssessment.findMany({
    where: {
      risk: { hazard: { activity: { establishmentId: destinoId } } },
      copiedFromId: { in: [...vigente.values()].map((a) => a.id) },
    },
    select: { riskId: true, copiedFromId: true },
  });
  const avaliacaoJaCopiada = new Set(avaliacoesD.map((a) => `${a.riskId}:${a.copiedFromId}`));
  const avaliacoes = [...vigente.values()].filter(
    (a) => !avaliacaoJaCopiada.has(`${idNoDestino(a.riskId)}:${a.id}`),
  );

  /* Exigências de treinamento, pela função. */
  const exigenciasO = await db.jobRoleRequirement.findMany({
    where: { jobRoleId: { in: funcoesO.map((f) => f.id) } },
    orderBy: { createdAt: "asc" },
  });
  const exigenciasD = await db.jobRoleRequirement.findMany({
    where: {
      jobRole: { sector: { establishmentId: destinoId } },
      copiedFromId: { in: exigenciasO.map((e) => e.id) },
    },
  });
  const exigencias = planejarNivel(
    "exigencias",
    exigenciasO,
    exigenciasD as Copiada[],
    (o) => `${idNoDestino(o.jobRoleId as string)}:${o.id}`,
    (d) => `${d.jobRoleId}:${d.copiedFromId}`,
  );

  return {
    novoId,
    idNoDestino,
    niveis: { setores, funcoes, atividades, perigos, riscos, medidas, exigencias },
    vinculos,
    avaliacoes,
  };
}

type Plano = Awaited<ReturnType<typeof planejar>>;

function resumo(plano: Plano) {
  const niveis: Record<Nivel, { criar: number; atualizar: number; iguais: number }> = Object.fromEntries(
    NIVEIS.map((n) => [n, { criar: 0, atualizar: 0, iguais: 0 }]),
  ) as never;
  for (const [n, p] of Object.entries(plano.niveis) as [NivelComConteudo, PlanoNivel][]) {
    niveis[n] = { criar: p.criar.length, atualizar: p.atualizar.length, iguais: p.iguais };
  }
  niveis.vinculos.criar = plano.vinculos.length;
  niveis.avaliacoes.criar = plano.avaliacoes.length;
  const conflitos = (Object.values(plano.niveis) as PlanoNivel[]).flatMap((p) => p.conflitos.map(([, , c]) => c));
  return { niveis, conflitos };
}

async function filiais(orgId: string, origemId: unknown, destinoId: string) {
  if (typeof origemId !== "string" || !origemId || origemId === destinoId) return null;
  const linhas = await prisma.establishment.findMany({
    where: { id: { in: [origemId, destinoId] }, organizationId: orgId, archivedAt: null },
    select: { id: true, name: true },
  });
  const origem = linhas.find((l) => l.id === origemId);
  const destino = linhas.find((l) => l.id === destinoId);
  return origem && destino ? { origem, destino } : null;
}

function podeCopiar(req: Request): boolean {
  const actor = (req as AuthRequest).actor;
  return Boolean(actor && canCopyBetweenUnits(actor.permission));
}

const NAO_PODE = { message: "Só o Master e o SST copiam entre filiais." };
const FILIAL_INVALIDA = { message: "Filial inválida." };

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

class EstablishmentCopyController {
  /** O que a cópia faria agora, sem gravar nada. */
  async preview(req: Request, res: Response) {
    try {
      if (!podeCopiar(req)) {
        res.status(403).json(NAO_PODE);
        return;
      }
      const orgId = actorOrgId(req as AuthRequest);
      const par = await filiais(orgId, (req.body ?? {}).origem, req.params.id);
      if (!par) {
        res.status(400).json(FILIAL_INVALIDA);
        return;
      }
      const plano = await prisma.$transaction((tx) => planejar(tx, par.origem.id, par.destino.id), {
        timeout: TIMEOUT_MS,
      });
      res.json({ origem: par.origem, destino: par.destino, ...resumo(plano) });
    } catch (err) {
      fail(res, err);
    }
  }

  async copy(req: Request, res: Response) {
    try {
      if (!podeCopiar(req)) {
        res.status(403).json(NAO_PODE);
        return;
      }
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const corpo = (req.body ?? {}) as { origem?: unknown; aceitar?: unknown };
      const par = await filiais(orgId, corpo.origem, req.params.id);
      if (!par) {
        res.status(400).json(FILIAL_INVALIDA);
        return;
      }
      if (
        corpo.aceitar !== undefined &&
        (!Array.isArray(corpo.aceitar) || corpo.aceitar.some((a) => typeof a !== "string"))
      ) {
        res.status(400).json({ message: "Informe os conflitos aceitos como uma lista." });
        return;
      }
      const aceitos = new Set((corpo.aceitar as string[] | undefined) ?? []);
      const origemId = par.origem.id;
      const destinoId = par.destino.id;

      const resultado = await prisma.$transaction(
        async (tx) => {
          const plano = await planejar(tx, origemId, destinoId);
          const agora = new Date();
          const marca = { copiedAt: agora, updatedAt: agora };
          const { novoId, idNoDestino, niveis } = plano;
          const contagem: Record<Nivel, { criados: number; atualizados: number }> = Object.fromEntries(
            NIVEIS.map((n) => [n, { criados: 0, atualizados: 0 }]),
          ) as never;
          const ignorados: Conflito[] = [];

          /** O que será atualizado: o que o destino não mexeu e o conflito aceito. */
          const paraAtualizar = (n: NivelComConteudo) => {
            const p: PlanoNivel = niveis[n];
            const aceitosAqui = p.conflitos.filter(([, d]) => aceitos.has(d.id));
            for (const [, , c] of p.conflitos) if (!aceitos.has(c.id)) ignorados.push(c);
            const lista = [...p.atualizar, ...aceitosAqui.map(([o, d]) => [o, d] as [Linha, Copiada])];
            contagem[n].atualizados = lista.length;
            contagem[n].criados = p.criar.length;
            return lista;
          };

          /* Setores. */
          await tx.sector.createMany({
            data: niveis.setores.criar.map((o) => ({
              id: novoId.get(o.id)!,
              organizationId: orgId,
              establishmentId: destinoId,
              ...(conteudo("setores", o) as { name: string }),
              copiedFromId: o.id,
              ...marca,
            })),
          });
          for (const [o, d] of paraAtualizar("setores")) {
            await tx.sector.update({ where: { id: d.id }, data: { ...conteudo("setores", o), ...marca } });
          }

          /* Funções. */
          await tx.jobRole.createMany({
            data: niveis.funcoes.criar.map((o) => ({
              id: novoId.get(o.id)!,
              organizationId: orgId,
              sectorId: idNoDestino(o.sectorId as string)!,
              ...(conteudo("funcoes", o) as { name: string }),
              copiedFromId: o.id,
              ...marca,
            })),
          });
          for (const [o, d] of paraAtualizar("funcoes")) {
            await tx.jobRole.update({ where: { id: d.id }, data: { ...conteudo("funcoes", o), ...marca } });
          }

          /* Atividades. */
          await tx.activity.createMany({
            data: niveis.atividades.criar.map((o) => ({
              id: novoId.get(o.id)!,
              organizationId: orgId,
              establishmentId: destinoId,
              sectorId: idNoDestino(o.sectorId as string)!,
              ...(conteudo("atividades", o) as { name: string }),
              copiedFromId: o.id,
              ...marca,
            })),
          });
          for (const [o, d] of paraAtualizar("atividades")) {
            await tx.activity.update({ where: { id: d.id }, data: { ...conteudo("atividades", o), ...marca } });
          }

          /* Vínculos que faltam. */
          await tx.activityJobRole.createMany({ data: plano.vinculos });
          contagem.vinculos.criados = plano.vinculos.length;

          /* Perigos: autor é quem copiou; sem AEP. */
          await tx.hazard.createMany({
            data: niveis.perigos.criar.map((o) => ({
              id: novoId.get(o.id)!,
              organizationId: orgId,
              activityId: idNoDestino(o.activityId as string)!,
              ...(conteudo("perigos", o) as { description: string }),
              aepId: null,
              createdById: actorId,
              copiedFromId: o.id,
              ...marca,
            })),
          });
          for (const [o, d] of paraAtualizar("perigos")) {
            await tx.hazard.update({ where: { id: d.id }, data: { ...conteudo("perigos", o), ...marca } });
          }

          /* Riscos: a avaliação chega para validar; a marca de reavaliar seria redundante. */
          await tx.risk.createMany({
            data: niveis.riscos.criar.map((o) => ({
              id: novoId.get(o.id)!,
              organizationId: orgId,
              hazardId: idNoDestino(o.hazardId as string)!,
              ...(conteudo("riscos", o) as { description: string }),
              needsReassessment: false,
              reassessmentReason: null,
              copiedFromId: o.id,
              ...marca,
            })),
          });
          for (const [o, d] of paraAtualizar("riscos")) {
            await tx.risk.update({ where: { id: d.id }, data: { ...conteudo("riscos", o), ...marca } });
          }

          /* Medidas: planejadas, sem ações. */
          await tx.controlMeasure.createMany({
            data: niveis.medidas.criar.map((o) => ({
              id: randomUUID(),
              organizationId: orgId,
              riskId: idNoDestino(o.riskId as string)!,
              ...(conteudo("medidas", o) as { type: never; description: string }),
              status: ControlStatus.PLANNED,
              implementedAt: null,
              effectivenessStatus: null,
              copiedFromId: o.id,
              ...marca,
            })),
          });
          for (const [o, d] of paraAtualizar("medidas")) {
            await tx.controlMeasure.update({ where: { id: d.id }, data: { ...conteudo("medidas", o), ...marca } });
          }

          /* Avaliações: em revisão, avaliadas por quem copiou. */
          await tx.riskAssessment.createMany({
            data: plano.avaliacoes.map((a) => ({
              id: randomUUID(),
              organizationId: orgId,
              riskId: idNoDestino(a.riskId)!,
              methodologyVersionId: a.methodologyVersionId,
              severity: a.severity,
              probability: a.probability,
              resultingLevel: a.resultingLevel,
              severityReason: a.severityReason,
              probabilityReason: a.probabilityReason,
              controlsConsidered: a.controlsConsidered,
              status: AssessmentStatus.IN_REVIEW,
              assessorId: actorId,
              assessedAt: agora,
              expiresAt: null,
              validatedById: null,
              validatedAt: null,
              supersededById: null,
              supersededAt: null,
              copiedFromId: a.id,
              ...marca,
            })),
          });
          contagem.avaliacoes.criados = plano.avaliacoes.length;

          /* Exigências: apontam para o mesmo treinamento, que é da empresa. */
          await tx.jobRoleRequirement.createMany({
            data: niveis.exigencias.criar.map((o) => ({
              id: randomUUID(),
              organizationId: orgId,
              jobRoleId: idNoDestino(o.jobRoleId as string)!,
              ...(conteudo("exigencias", o) as { name: string }),
              copiedFromId: o.id,
              ...marca,
            })),
          });
          for (const [o, d] of paraAtualizar("exigencias")) {
            await tx.jobRoleRequirement.update({
              where: { id: d.id },
              data: { ...conteudo("exigencias", o), ...marca },
            });
          }

          const registro = await tx.establishmentCopy.create({
            data: {
              organizationId: orgId,
              sourceEstablishmentId: origemId,
              targetEstablishmentId: destinoId,
              copiedById: actorId,
              counts: contagem,
            },
          });
          return { copia_id: registro.id, contagem, ignorados };
        },
        { timeout: TIMEOUT_MS },
      );

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "establishment.copy",
        entityType: "Establishment",
        entityId: destinoId,
        after: resultado.contagem,
        context: { origem: origemId, copia_id: resultado.copia_id, conflitos_ignorados: resultado.ignorados.length },
      });

      /*
        Quem copiou não valida as cópias (separação de funções): avisa os
        outros SSTs e Masters da empresa de que há avaliações para validar.
      */
      if (resultado.contagem.avaliacoes.criados > 0) {
        const validadores = await prisma.membership.findMany({
          where: {
            organizationId: orgId,
            role: { in: ["SST", "MASTER"] },
            suspendedAt: null,
            userId: { not: actorId },
            user: { active: true },
          },
          select: { userId: true },
        });
        await notifyMany(
          validadores.map((v) => v.userId),
          {
            organizationId: orgId,
            kind: NotificationKind.UNIT_COPY_AWAITING_VALIDATION,
            title: `Avaliações copiadas para ${par.destino.name}`,
            body: `${resultado.contagem.avaliacoes.criados} avaliação(ões) copiada(s) de ${par.origem.name} aguardam validação. Quem copiou não pode validar.`,
            /* Direto no inventário da filial que recebeu a cópia. [C4-2] */
            link: `/inventario?unidade=${encodeURIComponent(par.destino.id)}`,
            entityType: "EstablishmentCopy",
            entityId: resultado.copia_id,
          },
        );
      }

      res.json(resultado);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ message: "Outra cópia para esta filial terminou agora. Abra a prévia de novo." });
        return;
      }
      fail(res, err);
    }
  }
}

export default new EstablishmentCopyController();
