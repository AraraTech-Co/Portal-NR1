import { AssessmentStatus, PgrDocumentType } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId } from "../helper/org-scope";
import { REQUIRED_PGR_DOCUMENTS } from "../helper/compliance";
import { mudancasDesdeAEmissao } from "../helper/ordem-desatualizada";
import { formatCalendarDay } from "../helper/calendar-day";
import { canSeeAllInModule, isReadOnlyRole } from "../helper/module-access";
import type { AuthRequest } from "../types/auth";
import {
  ACTION_STATUS_LABEL,
  PARTICIPATION_TYPE_LABEL,
} from "../helper/rotulos";

/**
 * Quem vê o painel nome por nome: quem responde pelo PGR e a fiscalização.
 *
 * O painel atravessa módulos de pessoas (quem está sem treinamento, quem não
 * deu ciência). Para os demais papéis, a mesma lacuna aparece em número, sem
 * expor o colega. [S7-B]
 */
function detalhaPessoas(req: AuthRequest): boolean {
  return Boolean(
    req.actor && canSeeAllInModule(req.actor.permission, "documentos_pgr"),
  );
}

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/**
 * Um item do que a fiscalização olha. Sempre com AUTOR, QUANDO e para ONDE ir
 * ver a prova — sem isso o painel vira número solto. [S7-D]
 */
type Item = {
  ok: boolean;
  label: string;
  detail?: string | null;
  who?: string | null;
  when?: string | null;
  link?: string | null;
  /// Nível do risco, para a tela dar cor e legenda: documentação em dia não
  /// é a mesma coisa que risco sob controle. [B2-1-K]
  level?: string | null;
  /// Pendência que não é da empresa (função sem ninguém, por exemplo).
  note?: string | null;
};

type Check = {
  id: string;
  title: string;
  /** O que a norma pede, em uma linha, para o fiscal e para quem é cobrado. */
  requirement: string;
  status: "ok" | "pending" | "empty";
  summary: string;
  items: Item[];
};

/** As mesmas ações que envelhecem um documento emitido. [B2-4-A] */
const MUDA_O_PGR = [
  "hazard.",
  "risk.",
  "assessment.",
  "control.",
  "action.",
  "activity.",
  "sector.",
  "establishment.",
  "change_event.",
];

const DOC_LABEL: Record<string, string> = {
  INVENTORY: "Inventário de riscos",
  ACTION_PLAN: "Plano de ação",
  CRITERIA: "Critérios do GRO",
  AEP: "Avaliação ergonômica preliminar",
};

function check(
  id: string,
  title: string,
  requirement: string,
  items: Item[],
  vazio?: string,
): Check {
  const faltam = items.filter((i) => !i.ok).length;
  return {
    id,
    title,
    requirement,
    status: items.length === 0 ? "empty" : faltam === 0 ? "ok" : "pending",
    summary:
      items.length === 0
        ? (vazio ?? "Nada registrado.")
        : faltam === 0
          ? "Em ordem."
          : faltam === 1
            ? "1 pendência."
            : `${faltam} pendências.`,
    items,
  };
}

function quando(value: Date | string | null | undefined): string | null {
  return value ? formatCalendarDay(value) : null;
}

class InspectionController {
  /**
   * O que a fiscalização vê, inteiro e com as lacunas à mostra.
   *
   * O defeito que isto corrige não é falta de dado: é o portal mostrar só a
   * parte preenchida, de modo que o PGR parece pronto quando não está. Aqui
   * cada exigência aparece, com o que falta dito por extenso. [S7-B] [S7-D]
   */
  async overview(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const porPessoa = detalhaPessoas(auth);
      const establishmentId =
        typeof req.query.establishment_id === "string" && req.query.establishment_id
          ? req.query.establishment_id
          : null;
      const agora = new Date();
      const doEstabelecimento = establishmentId ? { establishmentId } : {};

      const [
        org,
        establishments,
        documentos,
        atividades,
        perigos,
        riscos,
        acoes,
        aeps,
        emergencias,
        funcoes,
        participacoes,
        exigencias,
      ] = await Promise.all([
        prisma.organization.findFirst({ where: { id: orgId } }),
        /*
          A lista vinha filtrada pela unidade escolhida e ficava com uma só;
          a tela esconde o seletor quando há menos de duas, então escolher
          uma unidade fazia o seletor sumir e só voltava recarregando a
          página. A lista é sempre inteira; o recorte é feito abaixo. [B2-1-B]
        */
        prisma.establishment.findMany({
          where: { organizationId: orgId, archivedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true, address: true, taxId: true },
        }),
        prisma.pgrDocument.findMany({
          where: { organizationId: orgId },
          orderBy: { version: "desc" },
          include: { issuedBy: { select: { name: true } } },
        }),
        prisma.activity.findMany({
          where: { organizationId: orgId, archivedAt: null, ...doEstabelecimento },
          select: {
            id: true,
            name: true,
            description: true,
            establishment: { select: { name: true } },
            _count: { select: { hazards: { where: { archivedAt: null } } } },
          },
          orderBy: { name: "asc" },
        }),
        prisma.hazard.findMany({
          where: {
            organizationId: orgId,
            archivedAt: null,
            ...(establishmentId ? { activity: { establishmentId } } : {}),
          },
          select: {
            id: true,
            description: true,
            createdAt: true,
            createdBy: { select: { name: true } },
            activity: { select: { name: true, establishment: { select: { name: true } } } },
            _count: { select: { risks: { where: { archivedAt: null } } } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.risk.findMany({
          where: {
            organizationId: orgId,
            archivedAt: null,
            ...(establishmentId ? { hazard: { activity: { establishmentId } } } : {}),
          },
          select: {
            id: true,
            description: true,
            needsReassessment: true,
            reassessmentReason: true,
            hazard: {
              select: {
                description: true,
                activity: { select: { name: true, establishment: { select: { name: true } } } },
              },
            },
            assessments: {
              where: { status: AssessmentStatus.VALIDATED },
              orderBy: { validatedAt: "desc" },
              take: 1,
              select: {
                resultingLevel: true,
                validatedAt: true,
                expiresAt: true,
                assessor: { select: { name: true } },
                validatedBy: { select: { name: true } },
              },
            },
            _count: { select: { controls: { where: { archivedAt: null } } } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.action.findMany({
          where: {
            organizationId: orgId,
            ...(establishmentId
              ? { OR: [{ risk: { hazard: { activity: { establishmentId } } } }, { riskId: null }] }
              : {}),
          },
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            completedAt: true,
            effectivenessCriteria: true,
            assignee: { select: { name: true } },
            createdBy: { select: { name: true } },
            validatedBy: { select: { name: true } },
            _count: { select: { evidences: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.aep.findMany({
          where: { organizationId: orgId, ...doEstabelecimento },
          select: {
            id: true,
            status: true,
            concludedAt: true,
            conductedAt: true,
            establishmentId: true,
            conductedBy: { select: { name: true } },
          },
          orderBy: { conductedAt: "desc" },
        }),
        prisma.emergencyProcedure.findMany({
          where: { organizationId: orgId, archivedAt: null, ...doEstabelecimento },
          select: {
            id: true,
            scenario: true,
            establishmentId: true,
            evacuationPlan: true,
            responsibles: true,
            drills: {
              orderBy: { performedAt: "desc" },
              take: 1,
              select: { performedAt: true, recordedBy: { select: { name: true } } },
            },
          },
        }),
        prisma.jobRole.findMany({
          where: {
            organizationId: orgId,
            archivedAt: null,
            ...(establishmentId ? { sector: { establishmentId } } : {}),
          },
          select: {
            id: true,
            name: true,
            sector: { select: { establishment: { select: { name: true } } } },
            serviceOrders: {
              orderBy: { version: "desc" },
              take: 1,
              select: {
                id: true,
                version: true,
                issuedAt: true,
                issuedBy: { select: { name: true } },
                _count: { select: { acks: true } },
              },
            },
            _count: {
              select: { employees: { where: { dismissedAt: null, user: { active: true } } } },
            },
          },
          orderBy: { name: "asc" },
        }),
        prisma.participationRecord.findMany({
          where: {
            organizationId: orgId,
            ...doEstabelecimento,
            occurredAt: { gte: new Date(agora.getFullYear() - 1, agora.getMonth(), agora.getDate()) },
          },
          select: {
            id: true,
            type: true,
            subject: true,
            occurredAt: true,
            recordedBy: { select: { name: true } },
            _count: { select: { evidences: true } },
          },
          orderBy: { occurredAt: "desc" },
        }),
        prisma.jobRoleRequirement.findMany({
          where: {
            organizationId: orgId,
            ...(establishmentId ? { jobRole: { sector: { establishmentId } } } : {}),
          },
          select: {
            id: true,
            name: true,
            validityMonths: true,
            /*
              A exigência podia apontar o treinamento do portal que a atende,
              e o painel não olhava para ele: contava só certificado enviado
              e aceito em Saúde. Quem concluiu o curso no próprio portal
              aparecia "sem certificado válido". [CB-70] [S7-G]
            */
            trainingId: true,
            training: {
              select: {
                id: true,
                title: true,
                passingScore: true,
                enrollments: {
                  where: { status: "COMPLETED" },
                  select: { userId: true, score: true, expiresAt: true },
                },
              },
            },
            jobRole: {
              select: {
                id: true,
                name: true,
                employees: {
                  where: { dismissedAt: null, user: { active: true } },
                  select: { userId: true, user: { select: { name: true } } },
                },
              },
            },
            certificates: {
              select: { userId: true, status: true, expiresAt: true },
            },
          },
        }),
      ]);

      if (!org) {
        res.status(404).json({ message: "Organização não encontrada." });
        return;
      }

      /*
        As unidades do recorte: a lista inteira alimenta o seletor da tela, e
        esta alimenta as verificações. [B2-1-B]
      */
      const noEscopo = establishmentId
        ? establishments.filter((e) => e.id === establishmentId)
        : establishments;

      const checks: Check[] = [];

      // 1. Os três documentos do PGR (1.5.7.2) — e quem assinou cada um.
      const porTipo = new Map<string, (typeof documentos)[number]>();
      for (const d of documentos) {
        const atual = porTipo.get(d.type);
        if (!atual || d.version > atual.version) porTipo.set(d.type, d);
      }
      const mudancasDesde = new Map<string, number>();
      for (const doc of porTipo.values()) {
        mudancasDesde.set(
          doc.id,
          await prisma.auditEvent.count({
            where: {
              organizationId: orgId,
              createdAt: { gt: doc.issuedAt },
              OR: MUDA_O_PGR.map((prefixo) => ({ action: { startsWith: prefixo } })),
            },
          }),
        );
      }
      checks.push(
        check(
          "documentos",
          "Documentos do PGR",
          "NR-1 1.5.7.2: inventário de riscos, plano de ação e critérios, datados e assinados.",
          REQUIRED_PGR_DOCUMENTS.map((tipo) => {
            const doc = porTipo.get(tipo);
            const mudou = doc ? (mudancasDesde.get(doc.id) ?? 0) : 0;
            return {
              /*
                Documento emitido não basta: se o inventário andou depois da
                assinatura, o papel não descreve mais a empresa — e era isso
                que o painel dava como em ordem. [B2-4-A]
              */
              ok: Boolean(doc) && mudou === 0,
              label: DOC_LABEL[tipo] ?? tipo,
              detail: !doc
                ? "nunca emitido"
                : mudou > 0
                  ? `v${doc.version} · desatualizado: ${mudou} mudança(s) depois da emissão`
                  : `v${doc.version}`,
              who: doc ? `${doc.responsibleName} (emitido por ${doc.issuedBy.name})` : null,
              when: quando(doc?.issuedAt),
              link: doc ? `/documentos/${doc.id}` : "/documentos",
            };
          }),
        ),
      );

      // 2. Quem responde pelo PGR (1.5.7.2 + OT SIT 3/2023).
      checks.push(
        check(
          "responsavel",
          "Responsável pelo PGR",
          "NR-1 1.5.7.2: os documentos são assinados sob responsabilidade da organização.",
          [
            {
              ok: Boolean(org.responsibleName),
              label: "Nome do responsável",
              detail: org.responsibleName ?? "não cadastrado",
              link: "/configuracoes",
            },
            {
              ok: Boolean(org.responsibleRole),
              label: "Cargo ou função",
              detail: org.responsibleRole ?? "não cadastrado",
              link: "/configuracoes",
            },
            {
              ok: Boolean(org.responsibleRegistration),
              label: "Registro profissional",
              detail: org.responsibleRegistration ?? "não cadastrado",
              link: "/configuracoes",
            },
          ],
        ),
      );

      // 3. O inventário, com as lacunas por extenso (1.5.7.3.2).
      const inventario: Item[] = [];
      for (const a of atividades.filter((x) => x._count.hazards === 0)) {
        inventario.push({
          ok: false,
          label: `Atividade sem perigo levantado: ${a.name}`,
          detail: a.establishment.name,
          link: "/inventario/registrar",
        });
      }
      for (const h of perigos.filter((x) => x._count.risks === 0)) {
        inventario.push({
          ok: false,
          label: `Perigo sem risco descrito: ${h.description}`,
          detail: `${h.activity.establishment.name} · ${h.activity.name}`,
          who: h.createdBy.name,
          when: quando(h.createdAt),
          link: "/inventario",
        });
      }
      for (const r of riscos) {
        const avaliacao = r.assessments[0];
        const onde = `${r.hazard.activity.establishment.name} · ${r.hazard.activity.name}`;
        if (!avaliacao) {
          inventario.push({
            ok: false,
            label: `Risco sem avaliação validada: ${r.description}`,
            detail: onde,
            link: "/inventario",
          });
          continue;
        }
        if (avaliacao.expiresAt && avaliacao.expiresAt < agora) {
          inventario.push({
            ok: false,
            level: avaliacao.resultingLevel,
            label: `Avaliação vencida: ${r.description}`,
            detail: `${onde} · venceu em ${quando(avaliacao.expiresAt)}`,
            who: `avaliado por ${avaliacao.assessor.name}, validado por ${avaliacao.validatedBy?.name ?? "—"}`,
            when: quando(avaliacao.validatedAt),
            link: "/inventario",
          });
          continue;
        }
        if (r.needsReassessment) {
          inventario.push({
            ok: false,
            level: avaliacao.resultingLevel,
            label: `Risco marcado para reavaliar: ${r.description}`,
            detail: r.reassessmentReason ?? onde,
            link: "/inventario",
          });
          continue;
        }
        inventario.push({
          ok: true,
          label: r.description,
          level: avaliacao.resultingLevel,
          detail: `${onde} · ${r._count.controls} medida(s)`,
          who: `avaliado por ${avaliacao.assessor.name}, validado por ${avaliacao.validatedBy?.name ?? "—"}`,
          when: quando(avaliacao.validatedAt),
          link: "/inventario",
        });
      }
      checks.push(
        check(
          "inventario",
          "Inventário de riscos",
          "NR-1 1.5.7.3.2: cada risco com caracterização, avaliação e revisão em dia.",
          inventario,
          "Nenhuma atividade cadastrada — o inventário começa pela operação.",
        ),
      );

      // 4. Plano de ação (1.5.5.2 e 1.5.5.2.2): dono, prazo e aferição.
      const plano: Item[] = acoes.map((a) => {
        const faltaDono = !a.assignee;
        const faltaPrazo = !a.dueDate;
        const atrasada =
          a.dueDate != null &&
          a.dueDate < agora &&
          !["VALIDATED", "CLOSED", "CANCELLED"].includes(a.status);
        const concluidaSemProva =
          ["WAITING_VALIDATION", "VALIDATED", "CLOSED"].includes(a.status) &&
          a._count.evidences === 0;
        const problemas = [
          faltaDono ? "sem responsável" : null,
          faltaPrazo ? "sem prazo" : null,
          atrasada ? `prazo vencido em ${quando(a.dueDate)}` : null,
          concluidaSemProva ? "concluída sem evidência" : null,
          !a.effectivenessCriteria ? "sem critério de eficácia" : null,
        ].filter(Boolean);
        return {
          ok: problemas.length === 0,
          label: a.title,
          detail:
            problemas.length > 0
              ? problemas.join(" · ")
              : `${ACTION_STATUS_LABEL[a.status]} · ${a._count.evidences} evidência(s)`,
          who: a.assignee?.name ?? `aberta por ${a.createdBy.name}`,
          when: quando(a.dueDate),
          link: "/acoes",
        };
      });
      checks.push(
        check(
          "plano_acao",
          "Plano de ação",
          "NR-1 1.5.5.2: cada ação com responsável, prazo, acompanhamento e aferição de resultado.",
          plano,
          "Nenhuma ação registrada.",
        ),
      );

      // 5. Ordem de serviço e a ciência (1.4.1 "c"). [S7-F] [B3-4-I]
      /*
        A ordem fica para trás quando o inventário da função muda depois da
        emissão: o Painel a dava como em ordem enquanto o trabalhador tinha
        dado ciência de uma ordem que não fala do risco de hoje. [CB-69]
      */
      const mudancasPorFuncao = new Map<string, number>();
      for (const f of funcoes) {
        const vigente = f.serviceOrders[0];
        if (!vigente) continue;
        mudancasPorFuncao.set(
          f.id,
          await mudancasDesdeAEmissao(orgId, f.id, vigente.issuedAt),
        );
      }
      const ordens: Item[] = funcoes.map((f) => {
        const vigente = f.serviceOrders[0];
        const pessoas = f._count.employees;
        const pendentes = vigente
          ? Math.max(pessoas - vigente._count.acks, 0)
          : pessoas;
        /*
          Função sem ninguém não pede ordem de serviço agora, e dizer "todos
          deram ciência" sugere que alguém leu. Misturar função vazia com
          função onde há gente trabalhando sem ordem esconde do fiscal o que
          importa. [B2-4-B]
        */
        const vazia = pessoas === 0;
        const mudancas = mudancasPorFuncao.get(f.id) ?? 0;
        const atrasada = Boolean(vigente) && mudancas > 0;
        const desatualizada = atrasada
          ? ` · desatualizada: ${mudancas} mudança(s) no inventário depois da emissão`
          : "";
        return {
          ok: vazia || (Boolean(vigente) && pendentes === 0 && !atrasada),
          label: f.name,
          note: vazia ? "ninguém nesta função" : null,
          detail: vazia
            ? vigente
              ? `v${vigente.version} · ninguém nesta função${desatualizada}`
              : "ninguém nesta função — a ordem entra quando houver gente"
            : vigente
              ? pendentes === 0
                ? `v${vigente.version} · todos deram ciência${desatualizada}`
                : `v${vigente.version} · ${pendentes} sem ciência${desatualizada}`
              : `${pessoas} pessoa(s) trabalhando sem ordem de serviço`,
          who: vigente ? vigente.issuedBy.name : null,
          when: quando(vigente?.issuedAt),
          link: vigente ? `/ordens-servico/${vigente.id}` : "/ordens-servico",
        };
      });
      checks.push(
        check(
          "ordens_servico",
          "Ordens de serviço",
          'NR-1 1.4.1 "c": elaborar ordens de serviço sobre segurança e saúde no trabalho, dando ciência aos trabalhadores.',
          ordens,
          "Nenhuma função cadastrada.",
        ),
      );

      // 6. AEP por estabelecimento (NR-17 17.3.1).
      const aepPorEst = new Map<string, (typeof aeps)[number]>();
      for (const a of aeps) {
        if (a.status === "CONCLUDED" && !aepPorEst.has(a.establishmentId)) {
          aepPorEst.set(a.establishmentId, a);
        }
      }
      checks.push(
        check(
          "aep",
          "Avaliação ergonômica preliminar",
          "NR-17 17.3.1: obrigatória para todas as situações de trabalho, inclusive quem é dispensado de PGR.",
          noEscopo.map((e) => {
            const a = aepPorEst.get(e.id);
            return {
              ok: Boolean(a),
              label: e.name,
              detail: a ? "AEP concluída" : "sem AEP concluída",
              who: a?.conductedBy.name ?? null,
              when: quando(a?.concludedAt ?? a?.conductedAt),
              link: "/aep",
            };
          }),
          "Nenhum estabelecimento cadastrado.",
        ),
      );

      // 7. Emergência (1.5.6.2 e 1.5.6.3).
      const emergPorEst = new Map<string, (typeof emergencias)[number][]>();
      for (const p of emergencias) {
        const lista = emergPorEst.get(p.establishmentId) ?? [];
        lista.push(p);
        emergPorEst.set(p.establishmentId, lista);
      }
      checks.push(
        check(
          "emergencia",
          "Preparação para emergências",
          "NR-1 1.5.6.2: primeiros socorros, abandono do local e responsáveis; 1.5.6.3: exercício simulado.",
          noEscopo.map((e) => {
            const planos = emergPorEst.get(e.id) ?? [];
            const comSimulado = planos.find((p) => p.drills[0]);
            const problemas = [
              planos.length === 0 ? "sem procedimento de emergência" : null,
              planos.length > 0 && !comSimulado ? "sem exercício simulado registrado" : null,
            ].filter(Boolean);
            return {
              ok: problemas.length === 0,
              label: e.name,
              detail:
                problemas.length > 0
                  ? problemas.join(" · ")
                  : `${planos.length} cenário(s) · último simulado registrado`,
              who: comSimulado?.drills[0]?.recordedBy.name ?? null,
              when: quando(comSimulado?.drills[0]?.performedAt),
              link: "/emergencias",
            };
          }),
          "Nenhum estabelecimento cadastrado.",
        ),
      );

      // 8. Participação dos trabalhadores (1.5.3.3). [B3-4-I]
      checks.push(
        check(
          "participacao",
          "Participação dos trabalhadores",
          "NR-1 1.5.3.3: consultar os trabalhadores sobre a percepção de riscos e comunicar a eles os riscos e as medidas do PGR.",
          participacoes.slice(0, 20).map((p) => ({
            ok: true,
            label: p.subject,
            detail: `${PARTICIPATION_TYPE_LABEL[p.type]} · ${p._count.evidences} evidência(s)`,
            who: p.recordedBy.name,
            when: quando(p.occurredAt),
            link: "/participacao",
          })),
          "Nenhum registro de participação nos últimos 12 meses.",
        ),
      );

      // 9. Treinamento e capacitação por função (1.7.1 e 1.7.1.1). [B3-4-I]
      const treinamentos: Item[] = [];
      for (const q of exigencias) {
        const validos = new Set(
          q.certificates
            .filter(
              (c) =>
                c.status === "APPROVED" && (!c.expiresAt || c.expiresAt > agora),
            )
            .map((c) => c.userId),
        );
        /*
          O curso concluído no próprio portal vale pela exigência que ele
          atende. Nota abaixo da mínima não vale: certificado assim está
          marcado para refazer e não comprova capacitação. [CB-70] [CB-31]
          Nota nula é o presencial, que não tem prova.
        */
        if (q.training) {
          const minima = q.training.passingScore;
          for (const i of q.training.enrollments) {
            const noPrazo = !i.expiresAt || i.expiresAt > agora;
            const passou = i.score === null || i.score >= minima;
            if (noPrazo && passou) validos.add(i.userId);
          }
        }
        const porCurso = q.training
          ? ` · conta o curso "${q.training.title}" do portal`
          : "";
        const pessoas = q.jobRole.employees;
        if (porPessoa) {
          for (const e of pessoas) {
            treinamentos.push({
              ok: validos.has(e.userId),
              label: `${e.user.name} — ${q.name}`,
              detail: validos.has(e.userId)
                ? `${q.jobRole.name} · em dia${porCurso}`
                : `${q.jobRole.name} · sem certificado válido${porCurso}`,
              link: "/saude",
            });
          }
          continue;
        }
        // Sem permissão para ver nome por nome: a lacuna aparece em número.
        const emDia = pessoas.filter((e) => validos.has(e.userId)).length;
        treinamentos.push({
          ok: pessoas.length > 0 && emDia === pessoas.length,
          label: `${q.jobRole.name} — ${q.name}`,
          detail:
            pessoas.length === 0
              ? "nenhum trabalhador ativo na função"
              : `${emDia} de ${pessoas.length} com certificado válido${porCurso}`,
          link: "/saude",
        });
      }
      /*
        Sem exigência por função cadastrada, o cartão dizia "Sem registro"
        mesmo com curso dado e turma realizada — o fiscal lia como falta o
        que estava feito. Enquanto a exigência por função não tem tela, o
        cartão conta o que existe em Treinamentos e diz o que falta. [B2-4-C]
      */
      const [cursos, turmas, concluidos] = await Promise.all([
        prisma.training.count({ where: { organizationId: orgId, archivedAt: null } }),
        prisma.trainingSession.count({ where: { organizationId: orgId } }),
        prisma.trainingEnrollment.count({
          where: { training: { organizationId: orgId }, status: "COMPLETED" },
        }),
      ]);
      if (treinamentos.length === 0 && cursos > 0) {
        /*
          O cartão ficava verde, "Em ordem", e dizia na mesma linha que sem
          exigência por função o portal não sabe quem precisa de qual
          treinamento. Não há como estar em ordem sem saber do que se fala:
          é pendência, e o que fecha é cadastrar a exigência. [CB-71]
        */
        treinamentos.push({
          ok: false,
          label: "Nenhuma exigência de treinamento por função cadastrada",
          detail: `Sem ela o portal não sabe quem precisa de qual treinamento. Hoje há ${cursos} treinamento(s) no portal · ${turmas} turma(s) presencial(is) · ${concluidos} conclusão(ões).`,
          link: "/saude",
        });
      }

      checks.push(
        check(
          "treinamentos",
          "Treinamento e capacitação",
          "NR-1 1.7.1 e 1.7.1.1: capacitação dos trabalhadores e certificado com o que a norma exige.",
          treinamentos,
          "Nenhum treinamento cadastrado e nenhuma exigência por função.",
        ),
      );

      res.json({
        generated_at: agora.toISOString(),
        organization: {
          name: org.name,
          taxId: org.taxId,
          responsibleName: org.responsibleName,
          responsibleRole: org.responsibleRole,
          responsibleRegistration: org.responsibleRegistration,
          assessmentReviewMonths: org.assessmentReviewMonths,
          hasSstCertification: org.hasSstCertification,
        },
        establishments,
        establishment_id: establishmentId,
        /// O cliente esconde o histórico e a lista de ciência quando é `false`.
        people_detail: porPessoa,
        checks,
        totals: {
          checks: checks.length,
          pending: checks.filter((c) => c.status === "pending").length,
          empty: checks.filter((c) => c.status === "empty").length,
          items_pending: checks.reduce(
            (soma, c) => soma + c.items.filter((i) => !i.ok).length,
            0,
          ),
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Quem mexeu no quê e quando. O portal já gravava tudo e não mostrava a
   * ninguém — e "histórico" é metade do que a fiscalização pede. [S7-D]
   *
   * Volta só o fato (ação, entidade, autor, data). O conteúdo de antes e
   * depois fica fora: ali pode haver dado de pessoa.
   */
  async history(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      if (!detalhaPessoas(auth)) {
        res.status(403).json({
          message: "Sem permissão para ver o histórico de quem mexeu no quê.",
        });
        return;
      }
      const take = Math.min(Number(req.query.limit) || 50, 200);
      const entityType =
        typeof req.query.entity_type === "string" && req.query.entity_type
          ? req.query.entity_type
          : null;

      // A consulta vê o histórico dos assuntos que ela pode abrir. Holerite,
      // atestado, denúncia, férias e mural ficam de fora: o módulo é X para
      // ela, e o histórico não pode ser a porta dos fundos.
      const soConsulta = auth.actor && isReadOnlyRole(auth.actor.permission);
      const assuntosDaConsulta = [
        "establishment",
        "sector",
        "job_role",
        "activity",
        "hazard",
        "risk",
        "assessment",
        "control",
        "action",
        "evidence",
        "pgr_document",
        "service_order",
        "change_event",
        "aep",
        "preliminary_survey",
        "occurrence",
        "emergency_procedure",
        "emergency_drill",
        "participation",
        "contractor",
        "training",
        "summon",
        "occupational_exam",
        "employee_profile",
        "hr_document",
        "consulta",
      ];

      const rows = await prisma.auditEvent.findMany({
        where: {
          organizationId: orgId,
          ...(entityType ? { entityType } : {}),
          ...(soConsulta
            ? {
                OR: assuntosDaConsulta.map((prefixo) => ({
                  action: { startsWith: `${prefixo}.` },
                })),
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      });

      res.json({
        events: rows.map((r) => ({
          id: r.id,
          action: r.action,
          entity_type: r.entityType,
          entity_id: r.entityId,
          at: r.createdAt,
          who: r.actor?.name ?? "sistema",
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new InspectionController();
