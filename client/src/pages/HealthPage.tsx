import { useEffect, useState } from "react";
import {
  createJobRoleRequirement,
  createOccupationalExam,
  fetchJobRoleRequirements,
  fetchOccupationalExams,
  fetchTrainings,
  fetchWorkerCertificates,
} from "@/api/modules";
import { fetchJobRoles, type JobRole } from "@/api/operation";
import { NewRecordSection } from "@/components/NewRecordSection";
import { PeoplePicker } from "@/components/PeoplePicker";
import { useModuleAccess } from "@/lib/module-access";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import {
  CERTIFICATE_STATUS_LABEL,
  EXAM_KIND_LABEL,
  formatDay,
  REQUIREMENT_KIND_LABEL,
} from "@/lib/labels";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { openProtectedFile } from "@/lib/protected-file";
import "@/components/data-table.css";
import { LoadingState } from "@/components/LoadingState";

export function HealthPage() {
  const [requirements, setRequirements] = useState<
    Awaited<ReturnType<typeof fetchJobRoleRequirements>>
  >([]);
  const [certificates, setCertificates] = useState<
    Awaited<ReturnType<typeof fetchWorkerCertificates>>
  >([]);
  const [exams, setExams] = useState<
    Awaited<ReturnType<typeof fetchOccupationalExams>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  /*
    O painel cobrava exigência por função e exame, e nenhum dos dois tinha
    tela: a empresa fazia tudo o que o portal permitia e o cartão continuava
    pendente. [B2-4-C]
  */
  const { canManage } = useModuleAccess("saude");
  const [funcoes, setFuncoes] = useState<JobRole[]>([]);
  const [recarregar, setRecarregar] = useState(0);
  const [funcao, setFuncao] = useState("");
  const [exigencia, setExigencia] = useState("");
  const [tipoExigencia, setTipoExigencia] = useState("CERTIFICATE");
  const [validade, setValidade] = useState("");
  /*
    A exigência podia apontar o curso do portal que a atende, e a tela não
    oferecia o campo: o Painel contava só certificado enviado em Saúde, e
    quem concluiu o curso aqui dentro aparecia sem certificado. [CB-70]
  */
  const [cursoDaExigencia, setCursoDaExigencia] = useState("");
  const [cursos, setCursos] = useState<{ id: string; title: string }[]>([]);
  const [quem, setQuem] = useState("");
  const [tipoExame, setTipoExame] = useState("PERIODIC");
  const [feitoEm, setFeitoEm] = useState("");
  const [proximo, setProximo] = useState("");
  const [apto, setApto] = useState(true);

  useEffect(() => {
    if (!canManage) return;
    fetchJobRoles()
      .then((d) => setFuncoes(d.job_roles))
      .catch(() => setFuncoes([]));
    fetchTrainings()
      .then((rows) =>
        setCursos(
          rows
            .filter((t) => !t.archivedAt)
            .map((t) => ({ id: t.id, title: t.title })),
        ),
      )
      .catch(() => setCursos([]));
  }, [canManage]);
  // Quem vê o registro de outras pessoas (RH, SST, fiscal) precisa saber de
  // quem é cada certificado e exame. [S5-K]
  const showPeople =
    certificates.some((c) => c.userId !== user?.id) || exams.some((e) => e.userId !== user?.id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJobRoleRequirements(),
      fetchWorkerCertificates(),
      fetchOccupationalExams(),
    ])
      .then(([req, certs, ex]) => {
        if (cancelled) return;
        setRequirements(req);
        setCertificates(certs);
        setExams(ex);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recarregar]);

  const empty =
    requirements.length === 0 &&
    certificates.length === 0 &&
    exams.length === 0;

  return (
    <div>
      <PageHeader
        title="Saúde e exigências"
        description="Exigências por função, certificados e exames ocupacionais."
      />
      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && empty && (
        <EmptyState
          title="Nada cadastrado"
          description="Exigências, certificados e exames ocupacionais aparecem aqui."
        />
      )}

      {/* Os formulários não dependem de já haver lista. [B2-4-C] */}
      <NewRecordSection
          canWrite={canManage}
          openLabel="Nova exigência por função"
          title="O que a função exige"
          description="É daqui que sai a cobrança de certificado, exame e treinamento de cada pessoa — e é isto que o Painel da fiscalização procura."
          submitLabel="Salvar exigência"
          disabled={!funcao || !exigencia.trim()}
          onSubmit={async () => {
            await createJobRoleRequirement({
              job_role_id: funcao,
              name: exigencia.trim(),
              kind: tipoExigencia,
              validity_months: validade ? Number(validade) : undefined,
              training_id: cursoDaExigencia || undefined,
            });
            setExigencia("");
            setValidade("");
            setCursoDaExigencia("");
            setRecarregar((v) => v + 1);
            return "Exigência salva.";
          }}
        >
          <div className="form-grid cols-2">
            <label className="form-field">
              Função
              <select value={funcao} onChange={(e) => setFuncao(e.target.value)} required>
                <option value="">Escolha a função</option>
                {funcoes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.establishment ? ` · ${f.establishment.name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Tipo
              <select
                value={tipoExigencia}
                onChange={(e) => setTipoExigencia(e.target.value)}
              >
                {Object.entries(REQUIREMENT_KIND_LABEL).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-field">
            O que é exigido
            <input
              value={exigencia}
              onChange={(e) => setExigencia(e.target.value)}
              placeholder="Ex.: NR-35 trabalho em altura"
              required
            />
          </label>
          <label className="form-field">
            Curso do portal que atende esta exigência (opcional)
            <select
              value={cursoDaExigencia}
              onChange={(e) => setCursoDaExigencia(e.target.value)}
            >
              <option value="">Nenhum — só certificado enviado</option>
              {cursos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <span className="form-hint">
              Ligando o curso, quem o concluir aqui dentro já conta como em
              dia no Painel da fiscalização — sem precisar enviar o
              certificado de novo.
            </span>
          </label>
          <label className="form-field">
            Vale por quantos meses (opcional)
            <input
              type="number"
              min={1}
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
            />
            <span className="form-hint">
              Em branco, não vence.
            </span>
          </label>
        </NewRecordSection>

      <NewRecordSection
          canWrite={canManage}
          openLabel="Registrar exame"
          title="Exame ocupacional"
          description="Admissional, periódico, de retorno, de mudança de função ou demissional. O próximo vencimento alimenta o aviso do Início e o Painel da fiscalização."
          submitLabel="Registrar exame"
          disabled={!quem}
          onSubmit={async () => {
            await createOccupationalExam({
              user_id: quem,
              kind: tipoExame,
              performed_at: feitoEm || undefined,
              due_at: proximo || undefined,
              fit: apto,
            });
            setQuem("");
            setFeitoEm("");
            setProximo("");
            setRecarregar((v) => v + 1);
            return "Exame registrado.";
          }}
        >
          <label className="form-field">
            De quem
            <PeoplePicker value={quem} onChange={(userId) => setQuem(userId)} />
          </label>
          <div className="form-grid cols-2">
            <label className="form-field">
              Tipo
              <select value={tipoExame} onChange={(e) => setTipoExame(e.target.value)}>
                {Object.entries(EXAM_KIND_LABEL).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Feito em
              <input
                type="date"
                value={feitoEm}
                onChange={(e) => setFeitoEm(e.target.value)}
              />
            </label>
          </div>
          <div className="form-grid cols-2">
            <label className="form-field">
              Próximo até
              <input
                type="date"
                value={proximo}
                onChange={(e) => setProximo(e.target.value)}
              />
            </label>
            <label className="form-field">
              Resultado
              <select
                value={apto ? "sim" : "nao"}
                onChange={(e) => setApto(e.target.value === "sim")}
              >
                <option value="sim">Apto</option>
                <option value="nao">Inapto</option>
              </select>
            </label>
          </div>
        </NewRecordSection>

      {!loading && !error && requirements.length > 0 && (
        <section className="form-section">
          <h2>Exigências por função</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Função</th>
                  <th>Tipo</th>
                  <th>Nome</th>
                  {/* De onde o Painel aceita a prova desta exigência. [CB-70] */}
                  <th>Curso do portal</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.id}>
                    <td>{r.jobRole.name}</td>
                    <td>
                      <Chip>{REQUIREMENT_KIND_LABEL[r.kind] ?? r.kind}</Chip>
                    </td>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td className="muted">
                      {r.training?.title ?? "só certificado enviado"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && !error && certificates.length > 0 && (
        <section className="form-section">
          <h2>Certificados</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {showPeople && <th>Pessoa</th>}
                  <th>Certificado</th>
                  <th>Situação</th>
                  <th>Validade</th>
                  <th aria-label="Arquivo" />
                </tr>
              </thead>
              <tbody>
                {certificates.map((c) => (
                  <tr key={c.id}>
                    {showPeople && <td>{c.user?.name ?? "—"}</td>}
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>
                      <Chip tone={c.status === "APPROVED" ? "success" : c.status === "REJECTED" ? "danger" : "warning"}>
                        {CERTIFICATE_STATUS_LABEL[c.status] ?? c.status}
                      </Chip>
                    </td>
                    <td className="muted">{formatDay(c.expiresAt)}</td>
                    <td>
                      {c.has_file ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void openProtectedFile(`/api/worker-certificates/${c.id}/file`)}
                        >
                          Abrir
                        </Button>
                      ) : (
                        <span className="muted">sem arquivo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && !error && exams.length > 0 && (
        <section className="form-section">
          <h2>Exames ocupacionais</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {showPeople && <th>Pessoa</th>}
                  <th>Tipo</th>
                  <th>Realizado</th>
                  <th>Vencimento</th>
                  <th>Apto</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.id}>
                    {showPeople && <td>{e.user?.name ?? "—"}</td>}
                    <td>{EXAM_KIND_LABEL[e.kind] ?? e.kind}</td>
                    <td className="muted">{formatDay(e.performedAt)}</td>
                    <td className="muted">{formatDay(e.dueAt)}</td>
                    <td>
                      {e.fit == null ? (
                        "—"
                      ) : e.fit ? (
                        <Chip tone="success">Sim</Chip>
                      ) : (
                        <Chip tone="danger">Não</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
