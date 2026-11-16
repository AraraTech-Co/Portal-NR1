import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { chaveDoCargo } from "../helper/chave-do-cargo";
import type { AuthRequest } from "../types/auth";

/**
 * Criar as funções que faltam a partir da prévia da planilha da folha
 * (Correção 6, C6-3 e C6-4; desenho de 16/11).
 *
 * Cada escolha é de um cargo numa filial:
 * - **criar:** uma função com o nome escolhido, num setor existente da
 *   filial ou num setor novo (o sistema nunca escolhe nem inventa setor);
 * - **juntar:** o cargo vira apelido de uma função da filial, ou de outro
 *   cargo desta mesma leva.
 *
 * Tudo numa transação travada pela empresa: ou cria tudo, ou nada. Setor e
 * função com a mesma chave na filial são reaproveitados, nunca duplicados —
 * também em dois cliques ou duas abas. Não cadastra pessoa e não cria filial.
 */

const MAX_ESCOLHAS = 200;
const CBO = /^[0-9][0-9.-]{0,9}$/;

class ErroDaEscolha extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Escolha = {
  filial_id?: unknown;
  cargo?: unknown;
  acao?: unknown;
  nome?: unknown;
  setor_id?: unknown;
  novo_setor?: unknown;
  cbo_2002?: unknown;
  cbo_94?: unknown;
  juntar_funcao_id?: unknown;
  juntar_cargo?: unknown;
};

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function hojeDdMmAaaa(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

type Criados = {
  setores: { id: string; name: string }[];
  funcoes: { id: string; name: string }[];
  apelidos: { id: string; chave: string; jobRoleId: string }[];
  reaproveitadas: number;
};

class PayrollStructureController {
  async criar(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const escolhas = (req.body as { escolhas?: unknown }).escolhas;
      if (!Array.isArray(escolhas) || escolhas.length === 0) {
        res.status(400).json({ message: "Envie as escolhas." });
        return;
      }
      if (escolhas.length > MAX_ESCOLHAS) {
        res.status(400).json({ message: `Até ${MAX_ESCOLHAS} escolhas por envio.` });
        return;
      }

      const criados: Criados = { setores: [], funcoes: [], apelidos: [], reaproveitadas: 0 };
      const descricao = `Criada pela planilha da folha em ${hojeDdMmAaaa()}.`;

      await prisma.$transaction(
        async (tx) => {
          /*
            Em read committed, dois envios leem "não existe" e os dois
            inserem: a trava da empresa serializa, e tudo abaixo é lido já com
            ela. [C6-3]
          */
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`estrutura-da-folha:${orgId}`}))`;

          const filiais = new Map(
            (
              await tx.establishment.findMany({
                where: { organizationId: orgId, archivedAt: null },
                select: { id: true, name: true },
              })
            ).map((f) => [f.id, f]),
          );
          const setores = await tx.sector.findMany({
            where: { organizationId: orgId, archivedAt: null },
            select: { id: true, name: true, establishmentId: true },
          });
          const funcoes = await tx.jobRole.findMany({
            where: { organizationId: orgId, archivedAt: null },
            select: { id: true, name: true, sector: { select: { establishmentId: true } } },
          });
          const apelidos = await tx.jobRoleAlias.findMany({
            where: { organizationId: orgId },
            select: { id: true, establishmentId: true, chave: true, jobRoleId: true, jobRole: { select: { name: true, archivedAt: true } } },
          });

          const setorPorChave = new Map<string, string[]>();
          for (const s of setores) {
            const k = `${s.establishmentId}:${chaveDoCargo(s.name)}`;
            setorPorChave.set(k, [...(setorPorChave.get(k) ?? []), s.id]);
          }
          const funcaoPorChave = new Map<string, { id: string; name: string }[]>();
          const filialDaFuncao = new Map<string, string>();
          for (const f of funcoes) {
            const k = `${f.sector.establishmentId}:${chaveDoCargo(f.name)}`;
            funcaoPorChave.set(k, [...(funcaoPorChave.get(k) ?? []), { id: f.id, name: f.name }]);
            filialDaFuncao.set(f.id, f.sector.establishmentId);
          }
          const apelidoPorChave = new Map(apelidos.map((a) => [`${a.establishmentId}:${a.chave}`, a]));
          const setorDaFilial = new Map(setores.map((s) => [s.id, s.establishmentId]));
          /* A função de cada cargo desta leva, para o "juntar com outro cargo". */
          const funcaoDoCargo = new Map<string, string>();

          const linhas = (escolhas as Escolha[]).map((e, i) => ({
            i: i + 1,
            filialId: texto(e.filial_id),
            cargo: texto(e.cargo),
            acao: texto(e.acao),
            e,
          }));
          const erro = (i: number, msg: string, status = 400): never => {
            throw new ErroDaEscolha(status, `Escolha ${i}: ${msg} Nada foi criado.`);
          };

          for (const l of linhas) {
            const filial = filiais.get(l.filialId);
            if (!filial) erro(l.i, "filial inválida.");
            if (!chaveDoCargo(l.cargo)) erro(l.i, "informe o cargo.");
            if (l.acao !== "criar" && l.acao !== "juntar") erro(l.i, 'a ação é "criar" ou "juntar".');
          }

          /* Apelido: a regra é a mesma para "juntar" e para o nome trocado no "criar". */
          const gravarApelido = async (i: number, filialId: string, chave: string, jobRoleId: string) => {
            if (filialDaFuncao.get(jobRoleId) !== filialId) erro(i, "a função escolhida não é desta filial.");
            const daFuncao = funcaoPorChave.get(`${filialId}:${chave}`) ?? [];
            if (daFuncao.some((f) => f.id !== jobRoleId)) {
              erro(i, `o cargo já casa com a função "${daFuncao[0]!.name}" desta filial.`, 409);
            }
            if (daFuncao.length > 0) return;
            const existente = apelidoPorChave.get(`${filialId}:${chave}`);
            if (existente) {
              if (existente.jobRoleId === jobRoleId) return;
              if (!existente.jobRole.archivedAt) {
                erro(i, `o cargo já está juntado com a função "${existente.jobRole.name}" nesta filial.`, 409);
              }
              /* Apontava para função arquivada: reaponta, em vez de bater na unicidade. */
              await tx.jobRoleAlias.update({ where: { id: existente.id }, data: { jobRoleId, createdById: actorId } });
              criados.apelidos.push({ id: existente.id, chave, jobRoleId });
              return;
            }
            const novo = await tx.jobRoleAlias.create({
              data: { organizationId: orgId, establishmentId: filialId, chave, jobRoleId, createdById: actorId },
            });
            apelidoPorChave.set(`${filialId}:${chave}`, { ...novo, jobRole: { name: "", archivedAt: null } });
            criados.apelidos.push({ id: novo.id, chave, jobRoleId });
          };

          /* Primeiro os "criar", para o "juntar" poder apontar para um cargo desta leva. */
          for (const l of linhas.filter((x) => x.acao === "criar")) {
            const chaveCargo = chaveDoCargo(l.cargo);
            const nome = texto(l.e.nome);
            if (!nome || !chaveDoCargo(nome)) erro(l.i, "informe o nome da função.");
            const cbo2002 = texto(l.e.cbo_2002) || null;
            const cbo94 = texto(l.e.cbo_94) || null;
            for (const [rotulo, valor] of [["CBO 2002", cbo2002], ["CBO 94", cbo94]] as const) {
              if (valor && !CBO.test(valor)) erro(l.i, `${rotulo} inválido: use os números do código, como 5211-25.`);
            }

            const chaveNome = chaveDoCargo(nome);
            const existentes = [
              ...(funcaoPorChave.get(`${l.filialId}:${chaveNome}`) ?? []),
              ...(chaveNome === chaveCargo ? [] : funcaoPorChave.get(`${l.filialId}:${chaveCargo}`) ?? []),
            ];
            let jobRoleId: string;
            if (existentes.length > 0) {
              /* Já existe: reaproveita, não cria outra (dois cliques, duas abas). */
              jobRoleId = existentes[0]!.id;
              criados.reaproveitadas += 1;
            } else {
              let sectorId = texto(l.e.setor_id);
              if (sectorId) {
                if (setorDaFilial.get(sectorId) !== l.filialId) erro(l.i, "o setor escolhido não é desta filial.");
              } else {
                const novoSetor = texto(l.e.novo_setor);
                if (!novoSetor || !chaveDoCargo(novoSetor)) erro(l.i, "escolha o setor ou dê o nome do setor novo.");
                const iguais = setorPorChave.get(`${l.filialId}:${chaveDoCargo(novoSetor)}`) ?? [];
                if (iguais.length > 1) erro(l.i, `há dois setores equivalentes a "${novoSetor}" nesta filial.`);
                if (iguais.length === 1) {
                  sectorId = iguais[0]!;
                } else {
                  const setor = await tx.sector.create({
                    data: { organizationId: orgId, establishmentId: l.filialId, name: novoSetor },
                  });
                  sectorId = setor.id;
                  setorPorChave.set(`${l.filialId}:${chaveDoCargo(novoSetor)}`, [setor.id]);
                  setorDaFilial.set(setor.id, l.filialId);
                  criados.setores.push({ id: setor.id, name: setor.name });
                }
              }
              const ultima = await tx.jobRole.aggregate({
                where: { organizationId: orgId, sectorId, archivedAt: null },
                _max: { position: true },
              });
              const nova = await tx.jobRole.create({
                data: {
                  organizationId: orgId,
                  sectorId,
                  name: nome,
                  description: descricao,
                  cbo2002,
                  cbo94,
                  position: (ultima._max.position ?? -1) + 1,
                },
              });
              jobRoleId = nova.id;
              funcaoPorChave.set(`${l.filialId}:${chaveNome}`, [{ id: nova.id, name: nova.name }]);
              filialDaFuncao.set(nova.id, l.filialId);
              criados.funcoes.push({ id: nova.id, name: nova.name });
            }
            funcaoDoCargo.set(`${l.filialId}:${chaveCargo}`, jobRoleId);
            /* O nome trocado não casa com o cargo: o cargo vira apelido dela. */
            if (chaveNome !== chaveCargo) await gravarApelido(l.i, l.filialId, chaveCargo, jobRoleId);
          }

          for (const l of linhas.filter((x) => x.acao === "juntar")) {
            const chaveCargo = chaveDoCargo(l.cargo);
            const funcaoId = texto(l.e.juntar_funcao_id);
            const outroCargo = texto(l.e.juntar_cargo);
            const destino = funcaoId || (outroCargo ? funcaoDoCargo.get(`${l.filialId}:${chaveDoCargo(outroCargo)}`) : undefined);
            if (!destino) erro(l.i, "escolha a função, ou o cargo desta planilha, com que juntar.");
            funcaoDoCargo.set(`${l.filialId}:${chaveCargo}`, destino!);
            await gravarApelido(l.i, l.filialId, chaveCargo, destino!);
          }
        },
        { timeout: 30_000 },
      );

      /* A trilha do cadastro à mão, com a origem; e a do apelido. */
      for (const s of criados.setores) {
        await writeAudit({
          organizationId: orgId,
          actorId,
          action: "sector.create",
          entityType: "Sector",
          entityId: s.id,
          after: { name: s.name, via: "planilha da folha" },
        });
      }
      for (const f of criados.funcoes) {
        await writeAudit({
          organizationId: orgId,
          actorId,
          action: "job_role.create",
          entityType: "JobRole",
          entityId: f.id,
          after: { name: f.name, via: "planilha da folha" },
        });
      }
      for (const a of criados.apelidos) {
        await writeAudit({
          organizationId: orgId,
          actorId,
          action: "job_role_alias.create",
          entityType: "JobRole",
          entityId: a.jobRoleId,
          after: { chave: a.chave, via: "planilha da folha" },
        });
      }

      res.status(201).json({
        setores_criados: criados.setores.length,
        funcoes_criadas: criados.funcoes.length,
        funcoes_reaproveitadas: criados.reaproveitadas,
        apelidos: criados.apelidos.length,
      });
    } catch (err) {
      if (err instanceof ErroDaEscolha) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      const e = err as { status?: number; message?: string };
      res.status(e.status || 500).json({ message: e.message || "Erro interno." });
    }
  }

  /** Remover o apelido: a mesma regra de quem junta (Operação e Conta). [C6-4] */
  async removerApelido(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const apelido = await prisma.jobRoleAlias.findFirst({
        where: { id: req.params.aliasId, jobRoleId: req.params.id, organizationId: orgId },
      });
      if (!apelido) {
        res.status(404).json({ message: "Apelido não encontrado." });
        return;
      }
      await prisma.jobRoleAlias.delete({ where: { id: apelido.id } });
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(auth),
        action: "job_role_alias.delete",
        entityType: "JobRole",
        entityId: apelido.jobRoleId,
        after: { chave: apelido.chave },
      });
      res.status(204).end();
    } catch (err) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 500).json({ message: e.message || "Erro interno." });
    }
  }
}

export default new PayrollStructureController();
