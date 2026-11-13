import { FormEvent, useEffect, useState } from "react";
import {
  fetchPayslipBatchEstablishments,
  fileToBase64,
  previewPayslipBatch,
  publishPayslipBatch,
  type PayslipBatchPart,
  type PayslipBatchSummary,
} from "@/api/payslips";
import { Button } from "@/components/Button";
import { PAYSLIP_KIND_LABEL, PAYSLIP_KIND_VALUES } from "@/lib/labels";
import "@/components/form.css";
import "./payslip-batch.css";

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const FORA_LABEL: Record<PayslipBatchPart["situacao"], string> = {
  CONFERE: "Confere",
  SEM_CADASTRO: "Sem cadastro",
  NAO_CONFERE: "Não confere",
  SEM_FUNCIONARIO: "Sem funcionário",
  VARIAS_PESSOAS: "Mais de uma pessoa",
  REPETIDA: "Matrícula repetida no arquivo",
};

function paginas(pages: number[]): string {
  return pages.length === 1
    ? `pág. ${pages[0]}`
    : `págs. ${pages[0]} a ${pages[pages.length - 1]}`;
}

type Previa = {
  total_pages: number;
  resumo: PayslipBatchSummary;
  parts: PayslipBatchPart[];
};

/**
 * A folha do mês num arquivo só.
 *
 * A loja recebe da contabilidade um PDF com todos os funcionários, uma página
 * por pessoa; publicar um por um eram duzentos envios por mês. O RH escolhe a
 * competência, confere o arquivo, vê quem confere e quem fica de fora, e só
 * então publica. Cada pessoa recebe só as próprias páginas. [B4-F]
 */
export function PayslipBatchSection({
  onPublished,
}: {
  onPublished: () => Promise<void>;
}) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  /* Adiantamento e mensal do mesmo mês são dois holerites. [B4-G] */
  const [kind, setKind] = useState("MONTHLY");
  const [file, setFile] = useState<File | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ocupado, setOcupado] = useState<"conferindo" | "publicando" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  /*
    A filial da folha: a matrícula 153 da loja e a da AG são pessoas
    diferentes. O portal acha a filial pelo código da empresa impresso em
    cada página; escolher na tela só é preciso quando falta o código da
    folha em alguma filial. Com uma filial só que quem envia alcança, ela já
    vem escolhida. [C3-3]
  */
  const [filiais, setFiliais] = useState<{ id: string; name: string }[]>([]);
  const [porFilial, setPorFilial] = useState(false);
  const [comCodigo, setComCodigo] = useState(true);
  const [filial, setFilial] = useState("");
  const filialObrigatoria = porFilial && !comCodigo;

  useEffect(() => {
    fetchPayslipBatchEstablishments()
      .then((r) => {
        setFiliais(r.filiais);
        setPorFilial(r.por_filial);
        setComCodigo(r.com_codigo);
        if (r.filiais.length === 1) setFilial(r.filiais[0]!.id);
      })
      .catch(() => {
        setFiliais([]);
        setPorFilial(false);
      });
  }, []);

  /* Mudou o arquivo ou a competência: a prévia de antes não vale mais. */
  function limpar() {
    setPrevia(null);
    setErro(null);
    setFeito(null);
  }

  async function pedido() {
    if (!file) throw new Error("Escolha o arquivo da folha.");
    if (filialObrigatoria && !filial) throw new Error("Escolha a filial da folha.");
    return {
      ...(filial ? { establishment_id: filial } : {}),
      reference_month: Number(month),
      reference_year: Number(year),
      kind,
      file_name: file.name,
      mime_type: file.type || "application/pdf",
      content_base64: await fileToBase64(file),
    };
  }

  async function conferir(e: FormEvent) {
    e.preventDefault();
    setOcupado("conferindo");
    limpar();
    try {
      setPrevia(await previewPayslipBatch(await pedido()));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao conferir o arquivo");
    } finally {
      setOcupado(null);
    }
  }

  async function publicar() {
    setOcupado("publicando");
    setErro(null);
    try {
      const r = await publishPayslipBatch(await pedido());
      const fora = r.resumo.de_fora;
      setFeito(
        `${r.publicados} holerite(s) publicado(s)` +
          (r.substituidos > 0 ? `, ${r.substituidos} substituindo o anterior` : "") +
          (fora > 0 ? `. ${fora} ficaram de fora.` : "."),
      );
      setPrevia(null);
      setFile(null);
      await onPublished();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao publicar");
    } finally {
      setOcupado(null);
    }
  }

  const conferem = previa?.parts.filter((p) => p.situacao === "CONFERE") ?? [];
  const deFora =
    previa?.parts.filter(
      (p) => p.situacao !== "CONFERE" && p.situacao !== "SEM_FUNCIONARIO",
    ) ?? [];
  const semFuncionario =
    previa?.parts
      .filter((p) => p.situacao === "SEM_FUNCIONARIO")
      .flatMap((p) => p.pages) ?? [];

  return (
    <section className="form-section">
      <h2>Publicar a folha do mês (um arquivo com todos)</h2>
      <p className="muted">
        Envie o PDF da folha com todos os funcionários, uma página por pessoa.
        O portal separa as páginas pela matrícula e confere cada uma como no
        envio individual. Cada pessoa recebe só as próprias páginas; o arquivo
        inteiro não fica guardado.
      </p>
      <form className="form-grid" onSubmit={conferir}>
        {porFilial && (
          <label className="form-field">
            Filial
            <select
              value={filial}
              onChange={(e) => {
                setFilial(e.target.value);
                limpar();
              }}
              disabled={ocupado !== null || filiais.length === 1}
              required={filialObrigatoria}
            >
              {filiais.length !== 1 && (
                <option value="">
                  {filialObrigatoria
                    ? "Escolha a filial da folha"
                    : "Pelo código da empresa em cada página"}
                </option>
              )}
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <span className="form-hint">
              {filialObrigatoria
                ? "Falta o código da folha em alguma filial: escolha a filial, e a matrícula é procurada só nas fichas dela. Com o código preenchido em todas, o portal acha a filial sozinho."
                : "O portal lê o código da empresa impresso em cada página (0682, 0683) e procura a matrícula só nas fichas da filial com esse código. Escolher uma filial confere que todas as páginas são dela."}
            </span>
          </label>
        )}
        <div className="form-grid cols-2">
          <label className="form-field">
            Mês
            <select
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                limpar();
              }}
              disabled={ocupado !== null}
            >
              {MONTHS.map((label, i) => (
                <option key={label} value={String(i + 1)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Ano
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                limpar();
              }}
              disabled={ocupado !== null}
              required
            />
          </label>
        </div>
        <label className="form-field">
          Tipo
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              limpar();
            }}
            disabled={ocupado !== null}
          >
            {PAYSLIP_KIND_VALUES.map((k) => (
              <option key={k} value={k}>
                {PAYSLIP_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          Arquivo da folha (PDF)
          <input
            type="file"
            accept="application/pdf"
            disabled={ocupado !== null}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              limpar();
            }}
            required
          />
        </label>
        {erro && (
          <p className="form-error" role="alert">
            {erro}
          </p>
        )}
        {feito && (
          <p className="muted" role="status">
            {feito}
          </p>
        )}
        <div className="form-actions">
          <Button
            type="submit"
            variant={previa ? "secondary" : "primary"}
            disabled={ocupado !== null || !file || (filialObrigatoria && !filial)}
          >
            {ocupado === "conferindo" ? "Conferindo…" : "Conferir o arquivo"}
          </Button>
        </div>
      </form>

      {previa && (
        <div className="lote-previa" aria-live="polite">
          <p className="lote-resumo">
            {previa.total_pages} página(s): <strong>{conferem.length} conferem</strong>
            {previa.resumo.substituem > 0 &&
              ` (${previa.resumo.substituem} já têm holerite deste tipo neste mês e serão substituídos)`}
            {deFora.length > 0 && <>, <strong>{deFora.length} ficam de fora</strong></>}.
          </p>

          {deFora.length > 0 && (
            <>
              <h3>Ficam de fora</h3>
              <p className="form-hint">
                Não serão publicados. Corrija o cadastro ou o arquivo e confira
                de novo, ou publique a pessoa pelo envio individual.
              </p>
              <ul className="lote-lista">
                {deFora.map((p) => (
                  <li key={p.pages.join("-")} className="lote-item lote-fora">
                    <div className="lote-quem">
                      <strong>
                        {p.document_name ?? "Sem nome"}
                        {p.registration && ` · matrícula ${p.registration}`}
                      </strong>
                      <span className="muted">
                        {p.filial && `${p.filial} · `}
                        {paginas(p.pages)} · {FORA_LABEL[p.situacao]}
                      </span>
                    </div>
                    <ul className="lote-motivos">
                      {p.motivos.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}

          {conferem.length > 0 && (
            <>
              <h3>Conferem</h3>
              <ul className="lote-lista">
                {conferem.map((p) => (
                  <li key={p.pages.join("-")} className="lote-item">
                    <div className="lote-quem">
                      <strong>{p.user_name}</strong>
                      <span className="muted">
                        {p.filial && `${p.filial} · `}
                        matrícula {p.registration} · {paginas(p.pages)}
                        {p.substitui && " · substitui o holerite já publicado"}
                      </span>
                    </div>
                    {p.avisos.length > 0 && (
                      <ul className="lote-motivos lote-avisos">
                        {p.avisos.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {semFuncionario.length > 0 && (
            <p className="form-hint">
              Página(s) sem funcionário, que não entram:{" "}
              {semFuncionario.join(", ")}.
            </p>
          )}

          {conferem.length > 0 ? (
            <div className="form-actions">
              <Button
                type="button"
                disabled={ocupado !== null}
                onClick={() => void publicar()}
              >
                {ocupado === "publicando"
                  ? "Publicando…"
                  : `Publicar ${conferem.length} holerite(s)`}
              </Button>
            </div>
          ) : (
            <p className="form-error">Nenhuma parte do arquivo confere.</p>
          )}
        </div>
      )}
    </section>
  );
}
