import { FormEvent, useState } from "react";
import {
  updateTrainingCertificateData,
  type DadosDoCertificadoDoTreinamento,
} from "@/api/trainings";
import { Button } from "@/components/Button";
import "@/components/form.css";

const CAMPOS: Array<{
  chave: keyof DadosDoCertificadoDoTreinamento;
  rotulo: string;
}> = [
  { chave: "instructor_name", rotulo: "Quem ministra" },
  { chave: "instructor_qualification", rotulo: "Qualificação de quem ministra" },
  { chave: "technical_responsible_name", rotulo: "Responsável técnico" },
  {
    chave: "technical_responsible_qualification",
    rotulo: "Qualificação do responsável técnico",
  },
];

/**
 * O que o certificado pede, nos treinamentos já cadastrados.
 *
 * O treinamento não se editava depois de criado: sem isto, os cursos que já
 * existem nunca teriam quem ministra nem o responsável técnico, e o
 * certificado sairia sem os dois (NR-1 1.7.1.1). [B3-3-G]
 */
export function TrainingCertificateData({
  trainingId,
  dados,
  canEdit,
  onSaved,
}: {
  trainingId: string;
  dados: DadosDoCertificadoDoTreinamento;
  canEdit: boolean;
  onSaved: (dados: DadosDoCertificadoDoTreinamento) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(dados);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const { training } = await updateTrainingCertificateData(trainingId, {
        instructor_name: rascunho.instructor_name?.trim() || null,
        instructor_qualification: rascunho.instructor_qualification?.trim() || null,
        technical_responsible_name: rascunho.technical_responsible_name?.trim() || null,
        technical_responsible_qualification:
          rascunho.technical_responsible_qualification?.trim() || null,
      });
      onSaved({
        instructor_name: training.instructorName,
        instructor_qualification: training.instructorQualification,
        technical_responsible_name: training.technicalResponsibleName,
        technical_responsible_qualification: training.technicalResponsibleQualification,
      });
      setEditando(false);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="tr-cert-data">
      <h3>Para o certificado</h3>
      {!editando && (
        <>
          <dl className="tr-cert-data-list">
            {CAMPOS.map(({ chave, rotulo }) => (
              <div key={chave}>
                <dt>{rotulo}</dt>
                <dd>{dados[chave] ?? <span className="muted">não informado</span>}</dd>
              </div>
            ))}
          </dl>
          {canEdit && (
            <Button
              type="button"
              size="compact"
              variant="secondary"
              onClick={() => {
                setRascunho(dados);
                setErro(null);
                setEditando(true);
              }}
            >
              Completar para o certificado
            </Button>
          )}
        </>
      )}
      {editando && (
        <form className="form-grid" onSubmit={salvar}>
          <p className="form-hint">
            A NR-1 (1.7.1.1) pede no certificado o nome e a qualificação de
            quem ministra e a assinatura do responsável técnico. No presencial,
            quem deu a aula é o da turma; o nome daqui vem sugerido nela. O
            local e a qualificação de quem deu a aula presencial se completam
            na própria turma, em "Turmas presenciais".
          </p>
          <div className="form-grid cols-2">
            {CAMPOS.map(({ chave, rotulo }) => (
              <label key={chave} className="form-field">
                {rotulo}
                <input
                  value={rascunho[chave] ?? ""}
                  onChange={(e) =>
                    setRascunho((r) => ({ ...r, [chave]: e.target.value }))
                  }
                  disabled={salvando}
                />
              </label>
            ))}
          </div>
          {erro && (
            <p className="form-error" role="alert">
              {erro}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditando(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
