import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { chaveDoNome } from "../helper/chave-do-nome";
import { scopeOfRequest } from "../helper/unit-scope";
import type { AuthRequest } from "../types/auth";

/**
 * Cadastrar setores e funções por planilha, em lote (desenho de 13/11).
 *
 * Só cria: nunca altera, move, arquiva nem apaga setor ou função. O nome é
 * comparado pela mesma chave da planilha de pessoas (`chaveDoNome`), e só o
 * que não está arquivado conta. A função "já existe" quando a mesma chave
 * está em qualquer setor da filial — a planilha de pessoas casa a função
 * pelo nome dentro da filial, e duas com o mesmo nome a deixariam ambígua.
 *
 * Cada envio grava numa transação travada pela empresa: dois envios ao
 * mesmo tempo, ou um duplo clique, não criam a mesma função duas vezes.
 */

const MAX_LINHAS = 200;
const CBO = /^[0-9][0-9.-]{0,9}$/;

type Situacao = "cria_setor_e_funcao" | "cria_funcao" | "ja_existe" | "repetida" | "erro";

type Resultado = {
  line: number;
  filial: string | null;
  setor: string;
  funcao: string;
  situacao: Situacao;
  message: string | null;
};

type Linha = {
  line?: unknown;
  filial?: unknown;
  setor?: unknown;
  funcao?: unknown;
  cbo_2002?: unknown;
  cbo_94?: unknown;
};

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** "0682" e "682" são o mesmo código da folha, como na planilha de pessoas. */
function codigoCanonico(c: string): string {
  const u = c.trim().toUpperCase();
  return /^\d+$/.test(u) ? u.replace(/^0+(?=\d)/, "") : u;
}

type Filial = { id: string; name: string; taxId: string | null; payrollCode: string | null };

/** A filial pelo código da folha, pelo CNPJ ou pelo nome — uma só, ou nenhuma. */
function acharFilial(valor: string, filiais: Filial[]): Filial[] {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length === 14) {
    const porCnpj = filiais.filter((f) => (f.taxId ?? "").replace(/\D/g, "") === digitos);
    if (porCnpj.length) return porCnpj;
  }
  const porCodigo = filiais.filter((f) => f.payrollCode && codigoCanonico(f.payrollCode) === codigoCanonico(valor));
  if (porCodigo.length) return porCodigo;
  return filiais.filter((f) => chaveDoNome(f.name) === chaveDoNome(valor));
}

class JobRoleImportController {
  async importar(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const body = req.body as { rows?: unknown; dry_run?: unknown };
      const simulacao = body.dry_run === true;
      if (!Array.isArray(body.rows) || body.rows.length === 0) {
        res.status(400).json({ message: "Envie as linhas da planilha." });
        return;
      }
      if (body.rows.length > MAX_LINHAS) {
        res.status(400).json({ message: `Até ${MAX_LINHAS} linhas por envio.` });
        return;
      }
      const linhas = body.rows as Linha[];
      const escopo = await scopeOfRequest(auth);

      const criados: { setores: { id: string; name: string }[]; funcoes: { id: string; name: string }[] } = {
        setores: [],
        funcoes: [],
      };

      const resultados = await prisma.$transaction(
        async (tx) => {
          /*
            Só a transação não basta: em read committed, dois envios leem
            "não existe" e os dois inserem. A trava da empresa serializa; a
            conferência abaixo é feita já com ela. A prévia não grava e não
            precisa esperar.
          */
          if (!simulacao) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-roles-import:${orgId}`}))`;
          }

          const filiais = await tx.establishment.findMany({
            where: { organizationId: orgId, archivedAt: null },
            select: { id: true, name: true, taxId: true, payrollCode: true },
          });
          const setores = await tx.sector.findMany({
            where: { organizationId: orgId, archivedAt: null },
            select: { id: true, name: true, establishmentId: true },
          });
          const funcoes = await tx.jobRole.findMany({
            where: { organizationId: orgId, archivedAt: null },
            select: { id: true, name: true, cbo2002: true, sector: { select: { establishmentId: true } } },
          });

          /* Os setores por filial e chave; os criados neste envio entram aqui também. */
          const setoresPorChave = new Map<string, { id: string }[]>();
          for (const s of setores) {
            const k = `${s.establishmentId}:${chaveDoNome(s.name)}`;
            setoresPorChave.set(k, [...(setoresPorChave.get(k) ?? []), { id: s.id }]);
          }
          const funcoesPorChave = new Map<string, { cbo2002: string | null }>();
          for (const f of funcoes) {
            funcoesPorChave.set(`${f.sector.establishmentId}:${chaveDoNome(f.name)}`, { cbo2002: f.cbo2002 });
          }
          const vistas = new Map<string, number>();
          const setoresNovos = new Map<string, string>();

          const out: Resultado[] = [];
          for (const [i, l] of linhas.entries()) {
            const line = typeof l.line === "number" ? l.line : i + 2;
            const valorFilial = texto(l.filial);
            const setor = texto(l.setor);
            const funcao = texto(l.funcao);
            const cbo2002 = texto(l.cbo_2002) || null;
            const cbo94 = texto(l.cbo_94) || null;
            const r: Resultado = { line, filial: null, setor, funcao, situacao: "erro", message: null };
            out.push(r);

            if (!valorFilial || !setor || !funcao) {
              r.message = "Informe a filial, o setor e a função.";
              continue;
            }
            const achadas = acharFilial(valorFilial, filiais);
            if (achadas.length !== 1) {
              r.message =
                achadas.length === 0
                  ? `Filial "${valorFilial}" não existe nesta empresa. Use o código da folha, o nome ou o CNPJ.`
                  : `"${valorFilial}" corresponde a mais de uma filial. Use o código da folha ou o CNPJ.`;
              continue;
            }
            const filial = achadas[0]!;
            r.filial = filial.name;
            if (!escopo.wholeOrg && !escopo.managed.includes(filial.id)) {
              r.message = `A filial ${filial.name} está fora das que você gere.`;
              continue;
            }
            for (const [rotulo, valor] of [["CBO 2002", cbo2002], ["CBO 94", cbo94]] as const) {
              if (valor && !CBO.test(valor)) {
                r.message = `${rotulo} inválido: use os números do código, como 5211-25.`;
              }
            }
            if (r.message) continue;

            const chaveFuncao = `${filial.id}:${chaveDoNome(funcao)}`;
            const existente = funcoesPorChave.get(chaveFuncao);
            if (existente) {
              r.situacao = "ja_existe";
              r.message =
                cbo2002 && existente.cbo2002 && existente.cbo2002 !== cbo2002
                  ? `Já existe na filial, com CBO 2002 ${existente.cbo2002}; a planilha diz ${cbo2002}. Nada muda: corrija pela edição da função, se for o caso.`
                  : "Já existe na filial. Nada muda.";
              continue;
            }
            const antes = vistas.get(chaveFuncao);
            if (antes !== undefined) {
              r.situacao = "repetida";
              r.message = `Repetida na planilha (já está na linha ${antes}).`;
              continue;
            }

            const chaveSetor = `${filial.id}:${chaveDoNome(setor)}`;
            const doSetor = setoresPorChave.get(chaveSetor) ?? [];
            if (doSetor.length > 1) {
              r.message = `O setor "${setor}" aparece mais de uma vez na filial ${filial.name}. Deixe um nome só em Operação.`;
              continue;
            }
            vistas.set(chaveFuncao, line);
            r.situacao = doSetor.length === 1 || setoresNovos.has(chaveSetor) ? "cria_funcao" : "cria_setor_e_funcao";
            r.message = null;
            if (simulacao) {
              /* Na prévia, o setor que esta planilha criaria vale para as linhas seguintes. */
              if (doSetor.length === 0) setoresNovos.set(chaveSetor, "previa");
              continue;
            }

            let sectorId = doSetor[0]?.id ?? setoresNovos.get(chaveSetor);
            if (!sectorId) {
              const novo = await tx.sector.create({
                data: { organizationId: orgId, establishmentId: filial.id, name: setor },
              });
              sectorId = novo.id;
              setoresNovos.set(chaveSetor, novo.id);
              criados.setores.push({ id: novo.id, name: novo.name });
            }
            const ultima = await tx.jobRole.aggregate({
              where: { organizationId: orgId, sectorId, archivedAt: null },
              _max: { position: true },
            });
            const nova = await tx.jobRole.create({
              data: {
                organizationId: orgId,
                sectorId,
                name: funcao,
                cbo2002,
                cbo94,
                position: (ultima._max.position ?? -1) + 1,
              },
            });
            funcoesPorChave.set(chaveFuncao, { cbo2002 });
            criados.funcoes.push({ id: nova.id, name: nova.name });
          }
          return out;
        },
        { timeout: 30_000 },
      );

      /* A mesma trilha do cadastro à mão, e uma da importação. */
      if (!simulacao) {
        for (const s of criados.setores) {
          await writeAudit({
            organizationId: orgId,
            actorId,
            action: "sector.create",
            entityType: "Sector",
            entityId: s.id,
            after: { name: s.name, via: "import" },
          });
        }
        for (const f of criados.funcoes) {
          await writeAudit({
            organizationId: orgId,
            actorId,
            action: "job_role.create",
            entityType: "JobRole",
            entityId: f.id,
            after: { name: f.name, via: "import" },
          });
        }
        if (criados.funcoes.length > 0) {
          await writeAudit({
            organizationId: orgId,
            actorId,
            action: "job_roles.import",
            entityType: "Organization",
            entityId: orgId,
            after: {
              rows: resultados.length,
              sectors_created: criados.setores.length,
              job_roles_created: criados.funcoes.length,
            },
          });
        }
      }

      const conta = (s: Situacao) => resultados.filter((r) => r.situacao === s).length;
      res.status(simulacao ? 200 : 201).json({
        dry_run: simulacao,
        rows: resultados.length,
        criariam: conta("cria_setor_e_funcao") + conta("cria_funcao"),
        ja_existem: conta("ja_existe"),
        repetidas: conta("repetida"),
        erros: conta("erro"),
        setores_criados: criados.setores.length,
        funcoes_criadas: criados.funcoes.length,
        results: resultados,
      });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 500).json({ message: e.message || "Erro interno." });
    }
  }
}

export default new JobRoleImportController();
