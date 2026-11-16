import { FormEvent, useEffect, useMemo, useState } from "react";
import { request } from "@/api/client";
import { cadastrarUmaPessoa, WORKER_BOND_LABEL, type ImportResult } from "@/api/people";
import { fetchContractorList } from "@/api/contractors";
import { fetchEstablishments, fetchJobRoles, type Establishment, type JobRole } from "@/api/operation";
import { Button } from "@/components/Button";
import { ORG_ROLE_LABEL } from "@/lib/labels";
import {
  chaveDoFormulario,
  faltaNoFormulario,
  FORMULARIO_VAZIO,
  funcoesDaFilial,
  papeisDoFormulario,
  pessoaDoFormulario,
  type Formulario,
} from "@/lib/cadastro-de-uma-pessoa";
import "@/components/form.css";

/**
 * Cadastrar uma pessoa à mão, sem planilha. Usa a mesma rota da planilha,
 * com `origem: "formulario"`: mesmas regras, mesmas permissões e o mesmo
 * primeiro acesso. Primeiro confere, depois cadastra.
 */
export function CadastrarUmaPessoa({ onCadastrada }: { onCadastrada: () => void }) {
  const [form, setForm] = useState<Formulario>(FORMULARIO_VAZIO);
  const [filiais, setFiliais] = useState<Establishment[]>([]);
  const [funcoes, setFuncoes] = useState<JobRole[]>([]);
  const [contratadas, setContratadas] = useState<{ id: string; name: string }[]>([]);
  const [podeDar, setPodeDar] = useState<string[]>([]);
  const [conferido, setConferido] = useState<{ chave: string; resultado: ImportResult } | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [f, j, c, p] = await Promise.all([
          fetchEstablishments(),
          fetchJobRoles(),
          fetchContractorList(),
          request<{ assignable: { org_roles: string[] } }>("/api/pessoas-acessos"),
        ]);
        const ativas = f.establishments.filter((e) => !e.archivedAt);
        setFiliais(ativas);
        setFuncoes(j.job_roles);
        setContratadas(c.map((x) => ({ id: x.id, name: x.name })));
        setPodeDar(papeisDoFormulario(p.assignable.org_roles));
        if (ativas.length === 1) setForm((atual) => ({ ...atual, filialId: ativas[0]!.id }));
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao carregar as listas.");
      }
    })();
  }, []);

  const daFilial = useMemo(() => funcoesDaFilial(funcoes, form.filialId), [funcoes, form.filialId]);
  const chave = chaveDoFormulario(form);
  const valeConferido = conferido !== null && conferido.chave === chave;
  const podeCadastrar = valeConferido && conferido!.resultado.status !== "error" && !enviando;

  /** Mudar qualquer campo apaga o que foi conferido. */
  function mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    setForm((atual) => ({
      ...atual,
      [campo]: valor,
      ...(campo === "filialId" ? { funcaoId: "" } : {}),
    }));
    setConferido(null);
    setFeito(null);
    setErro(null);
  }

  async function conferir(e: FormEvent) {
    e.preventDefault();
    const falta = faltaNoFormulario(form, filiais.length);
    if (falta) {
      setErro(falta);
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await cadastrarUmaPessoa(pessoaDoFormulario(form), true);
      setConferido({ chave, resultado: r.results[0]! });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao conferir.");
    } finally {
      setEnviando(false);
    }
  }

  async function cadastrar() {
    if (!podeCadastrar) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await cadastrarUmaPessoa(pessoaDoFormulario(form), false);
      const resultado = r.results[0]!;
      if (resultado.status === "error") {
        setConferido({ chave, resultado });
        return;
      }
      /* O login da resposta: outro cadastro pode ter tomado o da prévia. */
      setFeito(
        resultado.status === "created"
          ? `${resultado.name} cadastrada. Login: ${resultado.login}. Aguarda o primeiro acesso por 30 dias.`
          : `${resultado.name} já estava no portal${resultado.filled?.length ? `: a ficha foi completada (${resultado.filled.join(", ")})` : ""}.`,
      );
      setConferido(null);
      setForm({ ...FORMULARIO_VAZIO, filialId: filiais.length === 1 ? filiais[0]!.id : "" });
      onCadastrada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao cadastrar.");
    } finally {
      setEnviando(false);
    }
  }

  const r = valeConferido ? conferido!.resultado : null;

  return (
    <section className="form-section">
      <h2>Cadastrar uma pessoa</h2>
      <p className="muted">
        Para quem não veio na planilha. A pessoa entra com a matrícula ou o CPF e a data de nascimento, e cria a
        própria senha no primeiro acesso.
      </p>
      <form className="form-grid" onSubmit={conferir}>
        <div className="form-grid cols-2">
          <label className="form-field">
            Nome
            <input value={form.nome} onChange={(e) => mudar("nome", e.target.value)} required />
          </label>
          <label className="form-field">
            Data de nascimento
            <input type="date" value={form.nascimento} onChange={(e) => mudar("nascimento", e.target.value)} required />
          </label>
          <label className="form-field">
            CPF
            <input value={form.cpf} onChange={(e) => mudar("cpf", e.target.value)} inputMode="numeric" />
          </label>
          <label className="form-field">
            Matrícula
            <input value={form.matricula} onChange={(e) => mudar("matricula", e.target.value)} />
            <span className="form-hint">Preencha o CPF, a matrícula ou os dois.</span>
          </label>
          {filiais.length > 1 && (
            <label className="form-field">
              Filial
              <select value={form.filialId} onChange={(e) => mudar("filialId", e.target.value)} required>
                <option value="">Escolha a filial</option>
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="form-field">
            Função
            <select
              value={form.funcaoId}
              onChange={(e) => mudar("funcaoId", e.target.value)}
              disabled={!form.filialId}
            >
              <option value="">{form.filialId ? "Sem função" : "Escolha a filial antes"}</option>
              {daFilial.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Admissão
            <input type="date" value={form.admissao} onChange={(e) => mudar("admissao", e.target.value)} />
          </label>
          <label className="form-field">
            Papel
            <select value={form.papel} onChange={(e) => mudar("papel", e.target.value)}>
              {podeDar.map((p) => (
                <option key={p} value={p}>
                  {ORG_ROLE_LABEL[p] ?? p}
                </option>
              ))}
            </select>
            <span className="form-hint">Fiscal entra pelo pedido de entrada, que tem prazo de acesso.</span>
          </label>
          <label className="form-field">
            Vínculo
            <select value={form.vinculo} onChange={(e) => mudar("vinculo", e.target.value)}>
              {Object.entries(WORKER_BOND_LABEL).map(([codigo, rotulo]) => (
                <option key={codigo} value={codigo}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
          {form.vinculo === "CONTRACTOR" && (
            <label className="form-field">
              Empresa contratada
              <select value={form.contratadaId} onChange={(e) => mudar("contratadaId", e.target.value)} required>
                <option value="">Escolha a empresa</option>
                {contratadas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="form-field">
            E-mail (opcional)
            <input type="email" value={form.email} onChange={(e) => mudar("email", e.target.value)} />
          </label>
        </div>

        {r && (
          <p className={r.status === "error" ? "form-error" : "muted"} role="status">
            {r.status === "created" && `Pronto para entrar. Login previsto: ${r.login}.`}
            {r.status === "completed" && `${r.name} já está no portal: a ficha seria completada.`}
            {r.status === "skipped" && `${r.name} já está no portal, sem nada a mudar.`}
            {r.status === "error" && r.message}
          </p>
        )}
        {feito && (
          <p className="muted" role="status">
            {feito}
          </p>
        )}
        {erro && (
          <p className="form-error" role="alert">
            {erro}
          </p>
        )}

        <div className="form-actions">
          <Button type="submit" variant="secondary" disabled={enviando}>
            {enviando && !valeConferido ? "Conferindo…" : "Conferir"}
          </Button>
          {valeConferido && conferido!.resultado.status !== "error" && conferido!.resultado.status !== "skipped" && (
            <Button type="button" disabled={!podeCadastrar} onClick={() => void cadastrar()}>
              {enviando ? "Cadastrando…" : "Cadastrar"}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
