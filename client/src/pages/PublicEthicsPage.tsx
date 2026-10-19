import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchEthicsMeta } from "@/api/ethics";
import { EthicsReportPage } from "./EthicsReportPage";
import "./denuncia.css";

/**
 * O canal de denúncia fora do portal, sem login.
 *
 * O anonimato sempre existiu de verdade no banco — o relato anônimo não
 * guarda autor —, mas quem denunciava entrava com usuário e senha e não
 * tinha como saber disso. Aqui não há sessão nenhuma. [S4-L]
 *
 * A empresa vem no endereço, que é o link que ela divulga.
 */
export function PublicEthicsPage() {
  const { organizationId = "" } = useParams();
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [invalido, setInvalido] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetchEthicsMeta(organizationId)
      .then((meta) => {
        if (cancelado) return;
        if (meta.organization) setEmpresa(meta.organization.name);
        else setInvalido(true);
      })
      .catch(() => {
        if (!cancelado) setInvalido(true);
      });
    return () => {
      cancelado = true;
    };
  }, [organizationId]);

  if (invalido) {
    return (
      <div className="canal-page">
        <div className="canal-sheet">
          <p className="canal-eyebrow muted">Canal de denúncia</p>
          <h1>Link inválido</h1>
          <p className="muted">
            Este endereço não corresponde a nenhuma empresa. Confira o link com
            quem o enviou.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="canal-page">
      <div className="canal-sheet">
        <p className="canal-eyebrow muted">Canal de denúncia</p>
        <p className="canal-org">
          <strong>{empresa ?? "Carregando…"}</strong>
        </p>
        <EthicsReportPage organizationId={organizationId} publico />
      </div>
    </div>
  );
}
