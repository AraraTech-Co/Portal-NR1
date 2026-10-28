import { AssessmentStatus } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { formatCalendarDay } from "../helper/calendar-day";
import { EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT } from "../constants";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { REQUIRED_PGR_DOCUMENTS } from "../helper/compliance";
import {
  canManageModule,
  canReadModule,
  canSeeAllInModule,
} from "../helper/module-access";
import {
  canDecideJoinRequests,
  canManageInviteLinks,
} from "../helper/invite-access";
import {
  ethicsReportScope,
  isEthicsCommittee,
  podeTriarDenuncia,
} from "../helper/ethics-access";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Uma linha do painel: o que é, quantos, e para onde ir resolver. */
type Card = {
  id: string;
  label: string;
  count: number;
  link: string;
  /** "warning" quando já passou do prazo, "info" quando é só pendência. */
  tone?: "info" | "warning";
  detail?: string | null;
};

type Step = { id: string; label: string; done: boolean; link: string };

const EM_ABERTO = ["OPEN", "IN_PROGRESS"] as const;
/** Janela do "está vencendo": dois meses dá tempo de agendar. [S6-B] */
const DIAS_DE_AVISO = 60;

/**
 * O dia de calendário de uma data, como a tela a escreve: meia-noite UTC é
 * data sem hora; com hora, vale o dia em Brasília. [S3-B]
 */
function diaDeCalendario(date: Date): number {
  const meiaNoiteUtc =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  const base = meiaNoiteUtc ? date : new Date(date.getTime() - 3 * 3_600_000);
  return Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
}

/**
 * Quantos dias de calendário faltam. Contava em horas arredondadas para
 * cima: um acesso até o fim do dia 10 aparecia como 15 dias no dia 27, e o
 * calendário dá 14. [S6-B]
 */
export function diasAte(date: Date | null | undefined, agora = new Date()): number | null {
  if (!date) return null;
  return Math.round((diaDeCalendario(date) - diaDeCalendario(agora)) / 86_400_000);
}

/** O prazo, com a data: o cartão dizia "em 15 dia(s)" sem dizer quando. [S6-B] */
export function prazoTexto(date: Date | null | undefined, agora = new Date()): string | null {
  const dias = diasAte(date, agora);
  if (dias === null || !date) return null;
  const dia = formatCalendarDay(date);
  if (dias < 0) return `o mais antigo venceu em ${dia}, há ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return `o mais próximo vence hoje, ${dia}`;
  return `o mais próximo vence em ${dia}, daqui a ${dias} dia(s)`;
}

/**
 * Quando o próximo simulado vence: a mesma conta de Emergências (meses de
 * 30,44 dias depois do último), para as duas telas dizerem a mesma coisa.
 */
function proximoSimulado(ultimo: Date | null, meses: number): Date | null {
  if (!ultimo || meses <= 0) return null;
  return new Date(ultimo.getTime() + meses * 30.44 * 86_400_000);
}

class HomeController {
  /**
   * O painel de início, montado pelo papel de quem abre.
   *
   * Três perguntas que o portal sabia responder e não respondia: o que está
   * na minha mesa [S5-A], a empresa está em dia [S6-A], o que vence agora
   * [S6-B] — mais os primeiros passos de quem acabou de chegar [S1-F].
   */
  async overview(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const actor = auth.actor!;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const agora = new Date();
      const limite = new Date(Date.now() + DIAS_DE_AVISO * 86_400_000);

      const pode = (moduleId: string) => canReadModule(actor.permission, moduleId);
      const cuida = (moduleId: string) => canManageModule(actor.permission, moduleId);
      const veTodos = (moduleId: string) => canSeeAllInModule(actor.permission, moduleId);

      // ---------- o que é meu ----------
      const meu: Card[] = [];

      const [minhasAcoes, minhaFuncao] = await Promise.all([
        prisma.action.findMany({
          where: {
            organizationId: orgId,
            assigneeId: userId,
            status: { in: [...EM_ABERTO] },
          },
          select: { dueDate: true },
          orderBy: { dueDate: "asc" },
        }),
        prisma.employeeProfile.findFirst({
          where: { organizationId: orgId, userId, dismissedAt: null },
          select: { id: true, jobRoleId: true },
        }),
      ]);

      if (minhasAcoes.length > 0) {
        const atrasadas = minhasAcoes.filter((a) => a.dueDate && a.dueDate < agora).length;
        meu.push({
          id: "minhas_acoes",
          label: atrasadas > 0 ? "Ações suas, com prazo vencido" : "Ações no seu nome",
          count: atrasadas > 0 ? atrasadas : minhasAcoes.length,
          link: "/acoes",
          tone: atrasadas > 0 ? "warning" : "info",
          detail: prazoTexto(minhasAcoes[0]?.dueDate),
        });
      }

      if (minhaFuncao?.jobRoleId && pode("documentos_pgr")) {
        const ordem = await prisma.serviceOrder.findFirst({
          where: { organizationId: orgId, jobRoleId: minhaFuncao.jobRoleId },
          orderBy: { version: "desc" },
          select: { id: true, acks: { where: { userId }, select: { userId: true } } },
        });
        if (ordem && ordem.acks.length === 0) {
          meu.push({
            id: "ciencia_ordem",
            label: "Ordem de serviço da sua função esperando sua ciência",
            count: 1,
            link: `/ordens-servico/${ordem.id}`,
            tone: "warning",
          });
        }
      }

      if (minhaFuncao?.jobRoleId && pode("treinamentos")) {
        const exigencias = await prisma.jobRoleRequirement.findMany({
          where: { organizationId: orgId, jobRoleId: minhaFuncao.jobRoleId },
          select: {
            id: true,
            certificates: {
              where: { userId },
              select: { status: true, expiresAt: true },
            },
          },
        });
        const faltando = exigencias.filter(
          (q) =>
            !q.certificates.some(
              (c) => c.status === "APPROVED" && (!c.expiresAt || c.expiresAt > agora),
            ),
        ).length;
        if (faltando > 0) {
          meu.push({
            id: "minhas_exigencias",
            label: "Exigências da sua função sem comprovante em dia",
            count: faltando,
            link: minhaFuncao ? `/colaboradores/${minhaFuncao.id}` : "/treinamentos",
            tone: "warning",
          });
        }
      }

      if (pode("atestados")) {
        const recusados = await prisma.medicalCertificate.count({
          where: {
            organizationId: orgId,
            userId,
            status: "REJECTED",
            readByWorkerAt: null,
          },
        });
        if (recusados > 0) {
          meu.push({
            id: "atestado_recusado",
            label: "Atestado seu que o RH recusou e você ainda não leu",
            count: recusados,
            link: "/atestados",
            tone: "warning",
          });
        }
      }

      // ---------- o que está na minha mesa ----------
      const mesa: Card[] = [];

      if (cuida("atestados")) {
        const pendentes = await prisma.medicalCertificate.count({
          where: { organizationId: orgId, status: "PENDING", userId: { not: userId } },
        });
        if (pendentes > 0) {
          mesa.push({
            id: "atestados_pendentes",
            label: "Atestados esperando sua análise",
            count: pendentes,
            link: "/atestados",
            tone: "warning",
          });
        }
      }

      if (cuida("ferias")) {
        const pendentes = await prisma.leaveRequest.count({
          where: { organizationId: orgId, status: "REQUESTED" },
        });
        if (pendentes > 0) {
          mesa.push({
            id: "ferias_pendentes",
            label: "Pedidos de férias ou licença sem resposta",
            count: pendentes,
            link: "/ferias",
            tone: "info",
          });
        }
      }

      if (cuida("acoes")) {
        const [validar, atrasadas] = await Promise.all([
          prisma.action.count({
            where: { organizationId: orgId, status: "WAITING_VALIDATION" },
          }),
          prisma.action.count({
            where: {
              organizationId: orgId,
              status: { in: [...EM_ABERTO] },
              dueDate: { lt: agora },
            },
          }),
        ]);
        if (validar > 0) {
          mesa.push({
            id: "acoes_validar",
            label: "Ações concluídas esperando validação",
            count: validar,
            link: "/acoes",
            tone: "info",
          });
        }
        if (atrasadas > 0) {
          mesa.push({
            id: "acoes_atrasadas",
            label: "Ações com prazo vencido",
            count: atrasadas,
            link: "/acoes",
            tone: "warning",
          });
        }
      }

      if (cuida("ocorrencias")) {
        const semAnalise = await prisma.occurrence.count({
          where: { organizationId: orgId, analyzedAt: null },
        });
        if (semAnalise > 0) {
          mesa.push({
            id: "ocorrencias",
            label: "Ocorrências sem análise",
            count: semAnalise,
            link: "/ocorrencias",
            tone: "warning",
          });
        }
      }

      if (cuida("inventario")) {
        const rascunhos = await prisma.riskAssessment.count({
          where: { organizationId: orgId, status: AssessmentStatus.DRAFT },
        });
        if (rascunhos > 0) {
          mesa.push({
            id: "avaliacoes_rascunho",
            label: "Avaliações de risco esperando validação de outra pessoa",
            count: rascunhos,
            link: "/inventario",
            tone: "info",
          });
        }
      }

      /*
        A conta era de todas as denúncias em aberto da empresa, para quem
        tem o módulo. Quem foi tirado do caso via "2 em aberto" e encontrava
        uma só na lista: o número revelava a existência de um caso que ela
        não pode ver. A conta passa a ser a mesma lista. [CB-68] [CB-27]
        [B3-3-H]
      */
      if (
        (await isEthicsCommittee(orgId, userId, actor.permission)) ||
        podeTriarDenuncia(actor)
      ) {
        const abertas = await prisma.ethicsReport.count({
          where: {
            organizationId: orgId,
            status: { in: ["RECEIVED", "IN_ANALYSIS"] },
            ...(await ethicsReportScope(orgId, actor)),
          },
        });
        if (abertas > 0) {
          mesa.push({
            id: "denuncias",
            label: "Denúncias em aberto no comitê",
            count: abertas,
            link: "/comite",
            tone: "warning",
          });
        }
      }

      if (cuida("ideias")) {
        const novas = await prisma.idea.count({
          where: { organizationId: orgId, status: "NEW" },
        });
        if (novas > 0) {
          mesa.push({
            id: "ideias",
            label: "Ideias sem resposta",
            count: novas,
            link: "/ideias",
            tone: "info",
          });
        }
      }

      if (cuida("gamificacao")) {
        const pedidos = await prisma.rewardRedemption.count({
          where: { reward: { organizationId: orgId }, status: "REQUESTED" },
        });
        if (pedidos > 0) {
          mesa.push({
            id: "resgates",
            label: "Resgates de prêmio esperando entrega",
            count: pedidos,
            link: "/gamificacao",
            tone: "info",
          });
        }
      }

      /*
        O pedido de entrada é a pessoa esperando do lado de fora: ficava
        parado até alguém abrir Conta por acaso. O recorte é o mesmo da
        tela que decide — quem não cuida de Conta só vê os da sua. [CB-53]
      */
      if (canDecideJoinRequests(actor)) {
        const pedidos = await prisma.accountJoinRequest.count({
          where: {
            status: "PENDING",
            account: {
              organizationId: orgId,
              active: true,
              ...(actor.isMaster || canManageInviteLinks(actor)
                ? {}
                : { id: actor.accountId }),
            },
          },
        });
        if (pedidos > 0) {
          mesa.push({
            id: "pedidos_entrada",
            label: "Pedidos de entrada esperando aprovação",
            count: pedidos,
            link: "/conta",
            tone: "warning",
          });
        }
      }

      // ---------- a empresa está em dia? ----------
      let conformidade: Card[] | null = null;
      if (pode("documentos_pgr")) {
        const [
          documentos,
          riscosSemAvaliacao,
          avaliacoesVencidas,
          paraReavaliar,
          funcoesSemOrdem,
          estabelecimentos,
          comAep,
          comEmergencia,
        ] = await Promise.all([
          prisma.pgrDocument.groupBy({
            by: ["type"],
            where: { organizationId: orgId },
          }),
          prisma.risk.count({
            where: {
              organizationId: orgId,
              archivedAt: null,
              assessments: { none: { status: AssessmentStatus.VALIDATED } },
            },
          }),
          prisma.risk.count({
            where: {
              organizationId: orgId,
              archivedAt: null,
              assessments: {
                some: {
                  status: AssessmentStatus.VALIDATED,
                  supersededAt: null,
                  expiresAt: { lt: agora },
                },
              },
            },
          }),
          prisma.risk.count({
            where: { organizationId: orgId, archivedAt: null, needsReassessment: true },
          }),
          /*
            O Início contava toda função sem ordem, inclusive as vazias; o
            Painel e a tela de Ordens contam só as que têm gente, como pede o
            B2-4-B. O dono via 15 pendências aqui e 4 lá. Mesma regra.
            [B3-4-D]
          */
          prisma.jobRole.count({
            where: {
              organizationId: orgId,
              archivedAt: null,
              serviceOrders: { none: {} },
              employees: { some: { dismissedAt: null, user: { active: true } } },
            },
          }),
          prisma.establishment.findMany({
            where: { organizationId: orgId, archivedAt: null },
            select: { id: true },
          }),
          prisma.aep.findMany({
            where: { organizationId: orgId, status: "CONCLUDED" },
            select: { establishmentId: true },
            distinct: ["establishmentId"],
          }),
          prisma.emergencyProcedure.findMany({
            where: { organizationId: orgId, archivedAt: null },
            select: { establishmentId: true },
            distinct: ["establishmentId"],
          }),
        ]);

        const emitidos = new Set(documentos.map((d) => d.type));
        const faltamDocumentos = REQUIRED_PGR_DOCUMENTS.filter(
          (t) => !emitidos.has(t),
        ).length;
        const comAepSet = new Set(comAep.map((a) => a.establishmentId));
        const comEmergenciaSet = new Set(comEmergencia.map((e) => e.establishmentId));
        const semAep = estabelecimentos.filter((e) => !comAepSet.has(e.id)).length;
        const semEmergencia = estabelecimentos.filter(
          (e) => !comEmergenciaSet.has(e.id),
        ).length;

        conformidade = [
          {
            id: "documentos",
            label: "Documentos obrigatórios do PGR por emitir",
            count: faltamDocumentos,
            link: "/documentos",
            tone: "warning",
          },
          {
            id: "riscos_sem_avaliacao",
            label: "Riscos sem avaliação validada",
            count: riscosSemAvaliacao,
            link: "/inventario",
            tone: "warning",
          },
          {
            id: "avaliacoes_vencidas",
            label: "Riscos com avaliação vencida",
            count: avaliacoesVencidas,
            link: "/inventario",
            tone: "warning",
          },
          {
            id: "para_reavaliar",
            label: "Riscos marcados para reavaliar",
            count: paraReavaliar,
            link: "/inventario",
            tone: "info",
          },
          {
            id: "funcoes_sem_ordem",
            label: "Funções sem ordem de serviço",
            count: funcoesSemOrdem,
            link: "/ordens-servico",
            tone: "warning",
          },
          {
            id: "sem_aep",
            label: "Estabelecimentos sem avaliação ergonômica concluída",
            count: semAep,
            link: "/aep",
            tone: "warning",
          },
          {
            id: "sem_emergencia",
            label: "Estabelecimentos sem procedimento de emergência",
            count: semEmergencia,
            link: "/emergencias",
            tone: "warning",
          },
        ].filter((c) => c.count > 0) as Card[];
      }

      // ---------- o que vence agora ----------
      const vencendo: Card[] = [];

      if (pode("inventario")) {
        const avaliacoes = await prisma.riskAssessment.findMany({
          where: {
            organizationId: orgId,
            status: AssessmentStatus.VALIDATED,
            supersededAt: null,
            expiresAt: { lte: limite },
            risk: { archivedAt: null },
          },
          select: { expiresAt: true },
          orderBy: { expiresAt: "asc" },
        });
        if (avaliacoes.length > 0) {
          vencendo.push({
            id: "avaliacoes",
            label: "Avaliações de risco a revisar",
            count: avaliacoes.length,
            link: "/inventario",
            tone: avaliacoes[0]?.expiresAt && avaliacoes[0].expiresAt < agora ? "warning" : "info",
            detail: prazoTexto(avaliacoes[0]?.expiresAt),
          });
        }
      }

      if (pode("saude")) {
        const exames = await prisma.occupationalExam.findMany({
          where: {
            organizationId: orgId,
            dueAt: { lte: limite },
            ...(veTodos("saude") ? {} : { userId }),
          },
          select: { dueAt: true },
          orderBy: { dueAt: "asc" },
        });
        if (exames.length > 0) {
          vencendo.push({
            id: "exames",
            label: veTodos("saude")
              ? "Exames ocupacionais a fazer"
              : "Seus exames ocupacionais a fazer",
            count: exames.length,
            link: "/saude",
            tone: exames[0]?.dueAt && exames[0].dueAt < agora ? "warning" : "info",
            detail: prazoTexto(exames[0]?.dueAt),
          });
        }
      }

      if (pode("treinamentos")) {
        const certificados = await prisma.trainingEnrollment.findMany({
          where: {
            training: { organizationId: orgId },
            status: "COMPLETED",
            expiresAt: { lte: limite },
            ...(veTodos("treinamentos") ? {} : { userId }),
          },
          select: { expiresAt: true },
          orderBy: { expiresAt: "asc" },
        });
        if (certificados.length > 0) {
          vencendo.push({
            id: "treinamentos",
            label: veTodos("treinamentos")
              ? "Treinamentos a reciclar"
              : "Seus treinamentos a reciclar",
            count: certificados.length,
            link: "/treinamentos",
            tone:
              certificados[0]?.expiresAt && certificados[0].expiresAt < agora
                ? "warning"
                : "info",
            detail: prazoTexto(certificados[0]?.expiresAt),
          });
        }
      }

      if (veTodos("saude")) {
        const certificados = await prisma.workerCertificate.findMany({
          where: {
            organizationId: orgId,
            status: "APPROVED",
            expiresAt: { lte: limite },
          },
          select: { expiresAt: true },
          orderBy: { expiresAt: "asc" },
        });
        if (certificados.length > 0) {
          vencendo.push({
            id: "certificados",
            label: "Certificados de trabalhadores a renovar",
            count: certificados.length,
            link: "/saude",
            tone:
              certificados[0]?.expiresAt && certificados[0].expiresAt < agora
                ? "warning"
                : "info",
            detail: prazoTexto(certificados[0]?.expiresAt),
          });
        }
      }

      /*
        O simulado a vencer só aparecia em Emergências: quem abre o Início
        não ficava sabendo. Conta o procedimento cujo simulado vence na
        janela, e o que nunca teve simulado. [S6-B]
      */
      if (pode("emergencias")) {
        const procedimentos = await prisma.emergencyProcedure.findMany({
          where: { organizationId: orgId, archivedAt: null },
          select: {
            drillFrequencyMonths: true,
            drills: { orderBy: { performedAt: "desc" }, take: 1, select: { performedAt: true } },
          },
        });
        const devidos: Array<Date | null> = [];
        for (const p of procedimentos) {
          const meses = p.drillFrequencyMonths ?? EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT;
          if (meses <= 0) continue;
          const ultimo = p.drills[0]?.performedAt ?? null;
          if (!ultimo) {
            devidos.push(null);
            continue;
          }
          const vence = proximoSimulado(ultimo, meses)!;
          if (vence <= limite) devidos.push(vence);
        }
        if (devidos.length > 0) {
          const datas = devidos.filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime());
          const nunca = devidos.length - datas.length;
          vencendo.push({
            id: "simulados",
            label: "Simulados de emergência a fazer",
            count: devidos.length,
            link: "/emergencias",
            tone: nunca > 0 || (datas[0] && datas[0] < agora) ? "warning" : "info",
            detail:
              datas.length > 0
                ? prazoTexto(datas[0], agora)
                : nunca === 1
                  ? "um procedimento nunca teve simulado"
                  : `${nunca} procedimentos nunca tiveram simulado`,
          });
        }
      }

      if (canManageModule(actor.permission, "conta")) {
        const fiscais = await prisma.membership.findMany({
          where: {
            organizationId: orgId,
            role: "FISCAL",
            accessExpiresAt: { lte: limite, gt: agora },
          },
          select: { accessExpiresAt: true },
          orderBy: { accessExpiresAt: "asc" },
        });
        if (fiscais.length > 0) {
          vencendo.push({
            id: "acesso_fiscal",
            label: "Acessos de consulta a vencer",
            count: fiscais.length,
            link: "/conta",
            tone: "info",
            detail: prazoTexto(fiscais[0]?.accessExpiresAt),
          });
        }
      }

      // ---------- primeiros passos ----------
      let passos: Step[] | null = null;
      if (cuida("operacao") || cuida("documentos_pgr")) {
        const [estab, funcao, atividade, perigo, riscoAvaliado, acao, documento, ordem] =
          await Promise.all([
            prisma.establishment.count({ where: { organizationId: orgId, archivedAt: null } }),
            prisma.jobRole.count({ where: { organizationId: orgId, archivedAt: null } }),
            prisma.activity.count({ where: { organizationId: orgId, archivedAt: null } }),
            prisma.hazard.count({ where: { organizationId: orgId, archivedAt: null } }),
            prisma.riskAssessment.count({
              where: { organizationId: orgId, status: AssessmentStatus.VALIDATED },
            }),
            prisma.action.count({ where: { organizationId: orgId } }),
            prisma.pgrDocument.count({ where: { organizationId: orgId } }),
            prisma.serviceOrder.count({ where: { organizationId: orgId } }),
          ]);

        const lista: Step[] = [
          { id: "estabelecimento", label: "Cadastrar o estabelecimento", done: estab > 0, link: "/operacao" },
          { id: "funcao", label: "Cadastrar setores e funções", done: funcao > 0, link: "/operacao" },
          { id: "atividade", label: "Descrever as atividades", done: atividade > 0, link: "/operacao" },
          { id: "perigo", label: "Levantar os perigos", done: perigo > 0, link: "/inventario/registrar" },
          { id: "avaliacao", label: "Avaliar e validar os riscos", done: riscoAvaliado > 0, link: "/inventario" },
          { id: "acao", label: "Abrir as ações do plano", done: acao > 0, link: "/acoes" },
          { id: "ordem", label: "Emitir as ordens de serviço", done: ordem > 0, link: "/ordens-servico" },
          { id: "documento", label: "Emitir os documentos do PGR", done: documento > 0, link: "/documentos" },
        ];
        // Some sozinho quando a casa está montada — painel não é tutorial eterno.
        passos = lista.some((p) => !p.done) ? lista : null;
      }

      res.json({
        generated_at: agora.toISOString(),
        mine: meu,
        desk: mesa,
        compliance: conformidade,
        expiring: vencendo,
        /*
          Quando nada vence, o bloco sumia, e não dava para saber se o portal
          conferiu. Diz o que foi conferido, para a tela dizer "nada vence". [S6-B]
        */
        expiring_checked: [
          pode("inventario") && "avaliações de risco",
          pode("saude") && "exames",
          pode("treinamentos") && "treinamentos",
          veTodos("saude") && "certificados de trabalhadores",
          pode("emergencias") && "simulados",
          canManageModule(actor.permission, "conta") && "acessos de consulta",
        ].filter((x): x is string => Boolean(x)),
        first_steps: passos,
        window_days: DIAS_DE_AVISO,
      });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new HomeController();
