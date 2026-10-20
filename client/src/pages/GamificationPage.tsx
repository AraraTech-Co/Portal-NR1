import { useCallback, useEffect, useState } from "react";
import {
  createReward,
  decideRedemption,
  fetchPointRules,
  fetchPointsBalance,
  fetchRedemptions,
  fetchRewards,
  grantPoints,
  redeemReward,
  savePointRule,
  type PointRule,
  type Redemption,
} from "@/api/modules";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { NewRecordSection } from "@/components/NewRecordSection";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { formatDay, REDEMPTION_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/data-table.css";
import "@/components/form.css";

type Reward = Awaited<ReturnType<typeof fetchRewards>>[number];

function tone(status: string): "success" | "warning" | "neutral" {
  if (status === "DELIVERED" || status === "APPROVED") return "success";
  if (status === "REQUESTED") return "warning";
  return "neutral";
}

/**
 * Pontos e prêmios.
 *
 * A tela mostrava o saldo e a lista de prêmios, e não deixava fazer nada:
 * nem resgatar, nem publicar prêmio, nem lançar ponto — e os resgates
 * pedidos não apareciam para ninguém entregar. [OB-4] [CB-14]
 */
export function GamificationPage() {
  const { canManage } = useModuleAccess("gamificacao");
  const [balance, setBalance] = useState(0);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [rules, setRules] = useState<PointRule[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [acaoErro, setAcaoErro] = useState<string | null>(null);

  // Novo prêmio
  const [nome, setNome] = useState("");
  const [custo, setCusto] = useState("");
  const [estoque, setEstoque] = useState("");
  const [sobre, setSobre] = useState("");
  // Regra de pontos
  const [atividade, setAtividade] = useState("");
  const [pontos, setPontos] = useState("");
  // Lançamento
  const [quem, setQuem] = useState("");
  const [porQue, setPorQue] = useState("");
  const [quanto, setQuanto] = useState("");

  const recarregar = useCallback(async () => {
    const [bal, lista, resgates] = await Promise.all([
      fetchPointsBalance(),
      fetchRewards(),
      fetchRedemptions(),
    ]);
    setBalance(bal);
    setRewards(lista);
    setRedemptions(resgates.redemptions);
    const regras = await fetchPointRules().catch(() => []);
    setRules(regras);
  }, []);

  useEffect(() => {
    recarregar()
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }, [recarregar]);

  async function resgatar(reward: Reward) {
    setBusy(reward.id);
    setAcaoErro(null);
    try {
      await redeemReward(reward.id);
      await recarregar();
    } catch (err) {
      setAcaoErro(err instanceof Error ? err.message : "Falha ao resgatar");
    } finally {
      setBusy(null);
    }
  }

  async function decidir(id: string, status: string) {
    setBusy(id);
    setAcaoErro(null);
    try {
      await decideRedemption(id, status);
      await recarregar();
    } catch (err) {
      setAcaoErro(err instanceof Error ? err.message : "Falha ao decidir");
    } finally {
      setBusy(null);
    }
  }

  const pendentes = redemptions.filter((r) => r.status === "REQUESTED");

  return (
    <div>
      <PageHeader
        title="Gamificação"
        description="Pontos ganhos no trabalho e prêmios para resgatar."
        actions={!loading && !error ? <Chip tone="ouro">{balance} pts</Chip> : undefined}
      />

      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {acaoErro && (
        <p className="form-error" role="alert">
          {acaoErro}
        </p>
      )}

      {!loading && !error && (
        <>
          <NewRecordSection
            canWrite={canManage}
            openLabel="Novo prêmio"
            title="Novo prêmio"
            description="O que dá para trocar por pontos. Sem estoque informado, o prêmio é ilimitado."
            submitLabel="Publicar prêmio"
            disabled={!nome.trim() || !custo}
            onSubmit={async () => {
              await createReward({
                name: nome.trim(),
                cost: Number(custo),
                description: sobre.trim() || undefined,
                stock: estoque ? Number(estoque) : undefined,
              });
              setNome("");
              setCusto("");
              setEstoque("");
              setSobre("");
              await recarregar();
              return "Prêmio publicado.";
            }}
          >
            <label className="form-field">
              Prêmio
              <input value={nome} onChange={(e) => setNome(e.target.value)} required />
            </label>
            <div className="form-grid cols-2">
              <label className="form-field">
                Custo em pontos
                <input
                  type="number"
                  min={1}
                  value={custo}
                  onChange={(e) => setCusto(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                Quantos há (opcional)
                <input
                  type="number"
                  min={0}
                  value={estoque}
                  onChange={(e) => setEstoque(e.target.value)}
                />
              </label>
            </div>
            <label className="form-field">
              Detalhe (opcional)
              <textarea value={sobre} onChange={(e) => setSobre(e.target.value)} />
            </label>
          </NewRecordSection>

          <NewRecordSection
            canWrite={canManage}
            openLabel="Lançar pontos"
            title="Lançar pontos para alguém"
            description="Fica no extrato da pessoa e entra no saldo na hora."
            submitLabel="Lançar"
            disabled={!quem || !porQue.trim() || !quanto}
            onSubmit={async () => {
              await grantPoints({
                user_id: quem,
                activity: porQue.trim(),
                points: Number(quanto),
                note: undefined,
              });
              setQuem("");
              setPorQue("");
              setQuanto("");
              await recarregar();
              return "Pontos lançados.";
            }}
          >
            <label className="form-field">
              Para quem
              <PeoplePicker value={quem} onChange={(userId) => setQuem(userId)} />
            </label>
            <div className="form-grid cols-2">
              <label className="form-field">
                Por quê
                <input
                  value={porQue}
                  onChange={(e) => setPorQue(e.target.value)}
                  placeholder="Ex.: participou do simulado"
                  list="regras-de-ponto"
                  required
                />
                <datalist id="regras-de-ponto">
                  {rules.map((r) => (
                    <option key={r.id} value={r.activity} />
                  ))}
                </datalist>
              </label>
              <label className="form-field">
                Quantos pontos
                <input
                  type="number"
                  value={quanto}
                  onChange={(e) => setQuanto(e.target.value)}
                  required
                />
              </label>
            </div>
          </NewRecordSection>

          <NewRecordSection
            canWrite={canManage}
            openLabel="Regras de pontos"
            title="Quanto vale cada coisa"
            description="A regra guarda quanto vale uma atividade; lançar continua sendo um ato de alguém."
            submitLabel="Salvar regra"
            disabled={!atividade.trim() || !pontos}
            onSubmit={async () => {
              await savePointRule({
                activity: atividade.trim(),
                points: Number(pontos),
              });
              setAtividade("");
              setPontos("");
              await recarregar();
              return "Regra salva.";
            }}
          >
            {rules.length > 0 && (
              <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {rules.map((r) => (
                  <li key={r.id}>
                    {r.activity} · {r.points} pts
                  </li>
                ))}
              </ul>
            )}
            <div className="form-grid cols-2">
              <label className="form-field">
                Atividade
                <input
                  value={atividade}
                  onChange={(e) => setAtividade(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                Pontos
                <input
                  type="number"
                  value={pontos}
                  onChange={(e) => setPontos(e.target.value)}
                  required
                />
              </label>
            </div>
          </NewRecordSection>

          {rewards.length === 0 ? (
            <EmptyState
              title="Nenhum prêmio"
              description={
                canManage
                  ? "Publique o primeiro prêmio para quem junta pontos."
                  : "Quando a empresa publicar prêmios, eles aparecem aqui."
              }
            />
          ) : (
            <section className="form-section">
              <h2>Prêmios</h2>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Prêmio</th>
                      <th>Custo</th>
                      <th>Estoque</th>
                      <th aria-label="Resgatar" />
                    </tr>
                  </thead>
                  <tbody>
                    {rewards.map((r) => {
                      const semEstoque = r.stock !== null && r.stock <= 0;
                      const semPontos = balance < r.cost;
                      return (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.name}</strong>
                            {r.description && (
                              <div className="muted">{r.description}</div>
                            )}
                          </td>
                          <td>{r.cost} pts</td>
                          <td className="muted">
                            {r.stock == null ? "Ilimitado" : r.stock}
                          </td>
                          <td>
                            <Button
                              type="button"
                              size="compact"
                              variant="secondary"
                              disabled={busy === r.id || semEstoque || semPontos}
                              onClick={() => void resgatar(r)}
                            >
                              {busy === r.id ? "Resgatando…" : "Resgatar"}
                            </Button>
                            {/* Dizer por que não dá, em vez de só apagar o botão. */}
                            {(semEstoque || semPontos) && (
                              <div className="muted" style={{ fontSize: "0.78rem" }}>
                                {semEstoque
                                  ? "sem estoque"
                                  : `faltam ${r.cost - balance} pts`}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="form-section">
            <h2>
              {canManage ? "Resgates pedidos" : "Meus resgates"}
              {canManage && pendentes.length > 0 && (
                <span className="doc-sub-inline"> {pendentes.length} esperando</span>
              )}
            </h2>
            {redemptions.length === 0 ? (
              <p className="muted">
                {canManage
                  ? "Ninguém resgatou nada ainda."
                  : "Você ainda não resgatou nenhum prêmio."}
              </p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Prêmio</th>
                      {canManage && <th>Quem</th>}
                      <th>Custo</th>
                      <th>Pedido em</th>
                      <th>Situação</th>
                      {canManage && <th aria-label="Decidir" />}
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.map((r) => (
                      <tr key={r.id}>
                        <td>{r.reward.name}</td>
                        {canManage && <td>{r.user.name}</td>}
                        <td className="muted">{r.cost} pts</td>
                        <td className="muted">{formatDay(r.createdAt)}</td>
                        <td>
                          <Chip tone={tone(r.status)}>
                            {REDEMPTION_STATUS_LABEL[r.status] ?? r.status}
                          </Chip>
                          {r.decidedBy && (
                            <div className="muted" style={{ fontSize: "0.78rem" }}>
                              por {r.decidedBy.name}
                            </div>
                          )}
                        </td>
                        {canManage && (
                          <td>
                            {r.status === "REQUESTED" && (
                              <div className="form-actions">
                                <Button
                                  type="button"
                                  size="compact"
                                  variant="secondary"
                                  disabled={busy === r.id}
                                  onClick={() => void decidir(r.id, "DELIVERED")}
                                >
                                  Entreguei
                                </Button>
                                <Button
                                  type="button"
                                  size="compact"
                                  variant="ghost"
                                  disabled={busy === r.id}
                                  onClick={() => void decidir(r.id, "REJECTED")}
                                >
                                  Recusar
                                </Button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
