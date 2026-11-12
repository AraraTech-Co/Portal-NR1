import { useCallback, useEffect, useState } from "react";
import { fetchDadosDaFolha, updateDadosDaFolha, type DadosDaFolha } from "@/api/people";
import { Button } from "@/components/Button";
import { formatDay } from "@/lib/labels";

/**
 * Grau de instrução pelo código da folha (tabela do eSocial e da RAIS, que
 * coincidem de 1 a 9). Código fora daqui aparece como veio. [PF-2]
 */
const INSTRUCAO: Record<string, string> = {
  "1": "Analfabeto",
  "2": "Até o 5º ano incompleto do fundamental",
  "3": "5º ano completo do fundamental",
  "4": "Do 6º ao 9º ano incompleto do fundamental",
  "5": "Fundamental completo",
  "6": "Médio incompleto",
  "7": "Médio completo",
  "8": "Superior incompleto",
  "9": "Superior completo",
};

/** Nacionalidade pelo código da folha (tabela da RAIS); o código fica à vista. */
const NACIONALIDADE: Record<string, string> = {
  "10": "Brasileira",
  "20": "Naturalizado brasileiro",
  "21": "Argentina",
  "22": "Boliviana",
  "23": "Chilena",
  "24": "Paraguaia",
  "25": "Uruguaia",
  "26": "Venezuelana",
  "27": "Colombiana",
  "28": "Peruana",
  "29": "Equatoriana",
  "40": "Haitiana",
};

type Campo = Exclude<keyof DadosDaFolha, "competence" | "updated_at">;

const CAMPOS: { campo: Campo; rotulo: string; tipo?: "data" | "inteiro" }[] = [
  { campo: "rg", rotulo: "RG" },
  { campo: "pis", rotulo: "PIS" },
  { campo: "ctps_number", rotulo: "CTPS" },
  { campo: "ctps_series", rotulo: "Série da CTPS" },
  { campo: "ctps_uf", rotulo: "UF da CTPS" },
  { campo: "salary_type", rotulo: "Tipo de salário" },
  { campo: "fgts_option_date", rotulo: "Opção do FGTS", tipo: "data" },
  { campo: "dependents", rotulo: "Dependentes", tipo: "inteiro" },
  { campo: "education_level", rotulo: "Grau de instrução" },
  { campo: "nationality_code", rotulo: "Nacionalidade" },
  { campo: "address", rotulo: "Endereço" },
  { campo: "address_complement", rotulo: "Complemento" },
  { campo: "district", rotulo: "Bairro" },
  { campo: "city", rotulo: "Cidade" },
  { campo: "termination_date", rotulo: "Data da rescisão", tipo: "data" },
  { campo: "termination_cause", rotulo: "Causa da rescisão" },
  { campo: "movement_type", rotulo: "Tipo de movimento" },
];

function mostrar(campo: Campo, v: string | number | null): string {
  if (v === null || v === "") return "—";
  if (campo === "fgts_option_date" || campo === "termination_date") return formatDay(String(v));
  if (campo === "education_level") return INSTRUCAO[String(v)] ? `${INSTRUCAO[String(v)]} (código ${v})` : `Código ${v}`;
  if (campo === "nationality_code") return NACIONALIDADE[String(v)] ? `${NACIONALIDADE[String(v)]} (código ${v})` : `Código ${v}`;
  return String(v);
}

/**
 * Os dados da planilha da folha: RG, PIS, CTPS, endereço, dependentes,
 * instrução, nacionalidade e rescisão. Só aparece para quem pode ler
 * (Master, Dono e RH; a pessoa, os próprios). O salário não é guardado.
 * [PF-2]
 */
export function DadosDaFolhaSection({ profileId }: { profileId: string }) {
  const [estado, setEstado] = useState<{ dados: DadosDaFolha | null; pode_editar: boolean } | null>(null);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Partial<Record<Campo, string>>>({});
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setEstado(await fetchDadosDaFolha(profileId));
    } catch {
      /* 404: quem não pode ler não vê a seção. */
      setEstado(null);
    }
  }, [profileId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!estado) return null;
  const { dados, pode_editar } = estado;

  async function salvar() {
    setBusy(true);
    setErro(null);
    try {
      const mudou: Partial<Record<Campo, string | null>> = {};
      for (const { campo } of CAMPOS) {
        const antes = dados?.[campo] ?? null;
        const agora = rascunho[campo]?.trim() ?? "";
        if (String(antes ?? "") !== agora) mudou[campo] = agora || null;
      }
      await updateDadosDaFolha(profileId, mudou);
      setEditando(false);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  const competencia = dados?.competence ? `${dados.competence.slice(5)}/${dados.competence.slice(0, 4)}` : null;

  return (
    <section className="form-section">
      <h2>Dados da folha</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {competencia
          ? `Conforme a planilha da folha de ${competencia}.`
          : dados
            ? "Preenchidos à mão."
            : "Ainda não vieram da planilha da folha."}{" "}
        {pode_editar ? "Só Master, Dono e RH veem e editam." : "Só você e o RH veem estes dados."}
      </p>

      {!editando ? (
        <>
          {dados && (
            <dl className="people-facts">
              {CAMPOS.filter(({ campo }) => dados[campo] !== null && dados[campo] !== "").map(({ campo, rotulo }) => (
                <div key={campo}>
                  <dt>{rotulo}</dt>
                  <dd>{mostrar(campo, dados[campo])}</dd>
                </div>
              ))}
            </dl>
          )}
          {pode_editar && (
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                size="compact"
                onClick={() => {
                  setRascunho(
                    Object.fromEntries(CAMPOS.map(({ campo }) => [campo, dados?.[campo] == null ? "" : String(dados[campo])])),
                  );
                  setErro(null);
                  setEditando(true);
                }}
              >
                Editar dados da folha
              </Button>
            </div>
          )}
        </>
      ) : (
        <form
          className="form-grid cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          {CAMPOS.map(({ campo, rotulo, tipo }) => (
            <label key={campo} className="form-field">
              {rotulo}
              <input
                type={tipo === "data" ? "date" : tipo === "inteiro" ? "number" : "text"}
                min={tipo === "inteiro" ? 0 : undefined}
                value={rascunho[campo] ?? ""}
                onChange={(e) => setRascunho((r) => ({ ...r, [campo]: e.target.value }))}
              />
            </label>
          ))}
          {erro && (
            <p className="form-error" role="alert">
              {erro}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "Salvando…" : "Salvar dados da folha"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditando(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
