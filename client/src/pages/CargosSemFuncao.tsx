import { useEffect, useMemo, useState } from "react";
import { request } from "@/api/client";
import { fetchSectors, type JobRole, type Sector } from "@/api/operation";
import { Button } from "@/components/Button";
import { chaveDoCargo } from "@/lib/chave-do-cargo";
import type { CargoSemFuncao } from "@/lib/planilha";

/**
 * O bloco "Cargos sem função" da prévia (Correção 6, C6-2 e C6-3).
 *
 * Mostra os cargos que não casaram e, para quem cuida da Operação e da Conta
 * (Master e Dono), deixa escolher, cargo a cargo: criar a função num setor,
 * juntar com uma função ou com outro cargo, ou deixar de fora. Nada vem
 * marcado: o padrão é deixar de fora. O sistema nunca escolhe nem inventa
 * setor. Criar é um passo separado, com confirmação; as pessoas continuam só
 * no botão de cadastrar, depois da nova conferência.
 */

type Escolha = {
  acao: "fora" | "criar" | "juntar";
  nome: string;
  /** Id do setor existente, ou "novo". */
  setor: string;
  novoSetor: string;
  /** "f:<id da função>" ou "c:<chave de outro cargo do bloco>". */
  juntar: string;
};

const chaveDoBloco = (c: CargoSemFuncao) => `${c.filialId ?? c.filial}:${c.chave}`;

export function CargosSemFuncaoBloco({
  cargos,
  funcoes,
  podeCriar,
  onCriado,
}: {
  cargos: CargoSemFuncao[];
  funcoes: JobRole[];
  podeCriar: boolean;
  /** Recebe o resumo, para a tela mostrá-lo depois que o bloco some. */
  onCriado: (resumo: string) => Promise<void> | void;
}) {
  const [setores, setSetores] = useState<Sector[]>([]);
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  useEffect(() => {
    if (!podeCriar) return;
    fetchSectors()
      .then((d) => setSetores(d.sectors))
      .catch(() => setSetores([]));
  }, [podeCriar]);

  const escolhaDe = (c: CargoSemFuncao): Escolha =>
    escolhas[chaveDoBloco(c)] ?? { acao: "fora", nome: c.nome, setor: "", novoSetor: "", juntar: "" };
  const mudar = (c: CargoSemFuncao, parte: Partial<Escolha>) =>
    setEscolhas((e) => ({ ...e, [chaveDoBloco(c)]: { ...escolhaDe(c), ...parte } }));

  const setoresDa = (filialId: string | null) => setores.filter((s) => s.establishmentId === filialId);
  const funcoesDa = (filialId: string | null) => funcoes.filter((f) => f.establishment?.id === filialId);

  /*
    "Mesma escolha nas outras filiais": o mesmo cargo (mesma chave) em outra
    filial recebe a mesma ação. O setor e a função são procurados pelo nome
    equivalente na outra filial; o setor que não existe lá vira setor novo
    com o mesmo nome. [C6-3]
  */
  function aplicarNasOutras(origem: CargoSemFuncao) {
    const e = escolhaDe(origem);
    const nomeDoSetor = e.setor && e.setor !== "novo" ? setores.find((s) => s.id === e.setor)?.name ?? "" : e.novoSetor;
    const funcaoDeOrigem = e.juntar.startsWith("f:") ? funcoes.find((f) => f.id === e.juntar.slice(2)) : undefined;
    setEscolhas((atual) => {
      const novo = { ...atual };
      for (const c of cargos) {
        if (c === origem || c.chave !== origem.chave || !c.filialId) continue;
        let setor = "";
        let novoSetor = "";
        if (e.acao === "criar") {
          const igual = setoresDa(c.filialId).find((s) => chaveDoCargo(s.name) === chaveDoCargo(nomeDoSetor));
          if (igual) setor = igual.id;
          else {
            setor = "novo";
            novoSetor = nomeDoSetor;
          }
        }
        let juntar = e.juntar;
        if (funcaoDeOrigem) {
          const igual = funcoesDa(c.filialId).find((f) => chaveDoCargo(f.name) === chaveDoCargo(funcaoDeOrigem.name));
          juntar = igual ? `f:${igual.id}` : "";
        }
        novo[chaveDoBloco(c)] = { acao: e.acao, nome: e.nome, setor, novoSetor, juntar };
      }
      return novo;
    });
  }

  const marcadas = useMemo(
    () => cargos.filter((c) => c.filialId && escolhaDe(c).acao !== "fora"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cargos, escolhas],
  );

  async function criarMarcadas() {
    setErro(null);
    setFeito(null);
    const criar = marcadas.filter((c) => escolhaDe(c).acao === "criar");
    const setoresNovos = new Set(
      criar
        .filter((c) => escolhaDe(c).setor === "novo")
        .map((c) => `${c.filialId}:${chaveDoCargo(escolhaDe(c).novoSetor)}`),
    );
    const confirmado = window.confirm(
      `Isto cria ${criar.length} função(ões) e ${setoresNovos.size} setor(es) em Operação. As pessoas ainda não são cadastradas.`,
    );
    if (!confirmado) return;
    setOcupado(true);
    try {
      const corpo = marcadas.map((c) => {
        const e = escolhaDe(c);
        const cargo = c.variacoes[0]!.grafia;
        if (e.acao === "criar") {
          return {
            filial_id: c.filialId,
            cargo,
            acao: "criar",
            nome: e.nome.trim(),
            ...(e.setor && e.setor !== "novo" ? { setor_id: e.setor } : { novo_setor: e.novoSetor.trim() }),
            ...(c.cbo2002.length === 1 ? { cbo_2002: c.cbo2002[0] } : {}),
            ...(c.cbo94 ? { cbo_94: c.cbo94 } : {}),
          };
        }
        const outro = e.juntar.startsWith("c:")
          ? cargos.find((x) => x.filialId === c.filialId && x.chave === e.juntar.slice(2))
          : undefined;
        return {
          filial_id: c.filialId,
          cargo,
          acao: "juntar",
          ...(e.juntar.startsWith("f:") ? { juntar_funcao_id: e.juntar.slice(2) } : {}),
          ...(outro ? { juntar_cargo: outro.variacoes[0]!.grafia } : {}),
        };
      });
      const r = await request<{ funcoes_criadas: number; setores_criados: number; apelidos: number }>(
        "/api/pessoas-acessos/importar/estrutura",
        { method: "POST", body: JSON.stringify({ escolhas: corpo }) },
      );
      const resumo = `${r.funcoes_criadas} função(ões) e ${r.setores_criados} setor(es) criados; ${r.apelidos} cargo(s) juntado(s). A prévia foi conferida de novo.`;
      setFeito(resumo);
      setEscolhas({});
      await onCriado(resumo);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar as funções");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="cargos-sem-funcao" aria-labelledby="cargos-sem-funcao-titulo">
      <h3 id="cargos-sem-funcao-titulo">Cargos sem função nesta planilha: {cargos.length}</h3>
      <p className="muted">
        As pessoas destes cargos ficam de fora até a função existir. Nada foi gravado ainda.
      </p>
      {!podeCriar && (
        <p className="import-warning">Quem cuida da Operação (Master ou Dono) cria estas funções.</p>
      )}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Filial</th>
              <th>Cargo</th>
              <th>Variações</th>
              <th>CBO 2002</th>
              <th>Pessoas</th>
              <th>Sugestão</th>
              {podeCriar && <th>O que fazer</th>}
            </tr>
          </thead>
          <tbody>
            {cargos.map((c) => {
              const e = escolhaDe(c);
              const outrasFiliais = cargos.some((x) => x !== c && x.chave === c.chave && x.filialId);
              return (
                <tr key={chaveDoBloco(c)}>
                  <td>{c.filial || <span className="muted">—</span>}</td>
                  <td>
                    <strong>{c.nome}</strong>
                  </td>
                  <td>
                    {c.variacoes.length > 1 ? (
                      c.variacoes.map((v) => `${v.grafia} (${v.linhas})`).join(", ")
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {c.cbo2002.length === 0 ? <span className="muted">—</span> : c.cbo2002.join(", ")}
                    {c.cbo2002.length > 1 && (
                      <div className="import-row-warning">CBO diferente entre as linhas: confira</div>
                    )}
                  </td>
                  <td>{c.pessoas}</td>
                  <td>{c.sugestoes.length > 0 ? c.sugestoes.join("; ") : <span className="muted">—</span>}</td>
                  {podeCriar && (
                    <td className="cargo-acoes">
                      {!c.filialId ? (
                        <span className="muted">Sem filial na linha: informe a filial na planilha.</span>
                      ) : (
                        <>
                          <select
                            aria-label={`O que fazer com ${c.nome} em ${c.filial}`}
                            value={e.acao}
                            onChange={(ev) => mudar(c, { acao: ev.target.value as Escolha["acao"] })}
                            disabled={ocupado}
                          >
                            <option value="fora">Deixar de fora</option>
                            <option value="criar">Criar no setor</option>
                            <option value="juntar">Juntar com</option>
                          </select>
                          {e.acao === "criar" && (
                            <>
                              <input
                                aria-label={`Nome da função para ${c.nome}`}
                                value={e.nome}
                                onChange={(ev) => mudar(c, { nome: ev.target.value })}
                                disabled={ocupado}
                              />
                              <select
                                aria-label={`Setor da função ${c.nome}`}
                                value={e.setor}
                                onChange={(ev) => mudar(c, { setor: ev.target.value })}
                                disabled={ocupado}
                              >
                                <option value="">Escolha o setor</option>
                                {setoresDa(c.filialId).map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                                <option value="novo">Novo setor…</option>
                              </select>
                              {e.setor === "novo" && (
                                <input
                                  aria-label={`Nome do setor novo para ${c.nome}`}
                                  placeholder="Nome do setor"
                                  value={e.novoSetor}
                                  onChange={(ev) => mudar(c, { novoSetor: ev.target.value })}
                                  disabled={ocupado}
                                />
                              )}
                            </>
                          )}
                          {e.acao === "juntar" && (
                            <select
                              aria-label={`Juntar ${c.nome} com`}
                              value={e.juntar}
                              onChange={(ev) => mudar(c, { juntar: ev.target.value })}
                              disabled={ocupado}
                            >
                              <option value="">Escolha a função ou o cargo</option>
                              {funcoesDa(c.filialId).map((f) => (
                                <option key={f.id} value={`f:${f.id}`}>
                                  {f.name}
                                </option>
                              ))}
                              {cargos
                                .filter((x) => x !== c && x.filialId === c.filialId)
                                .map((x) => (
                                  <option key={`c:${x.chave}`} value={`c:${x.chave}`}>
                                    {x.nome} (desta planilha)
                                  </option>
                                ))}
                            </select>
                          )}
                          {outrasFiliais && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="compact"
                              onClick={() => aplicarNasOutras(c)}
                              disabled={ocupado}
                            >
                              Mesma escolha nas outras filiais
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      {feito && (
        <p className="form-success" role="status">
          {feito}
        </p>
      )}
      {podeCriar && (
        <div className="form-actions">
          <Button type="button" disabled={ocupado || marcadas.length === 0} onClick={() => void criarMarcadas()}>
            {ocupado ? "Criando…" : "Criar as funções marcadas"}
          </Button>
        </div>
      )}
    </section>
  );
}
