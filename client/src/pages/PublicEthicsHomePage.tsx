import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { fetchEthicsMeta } from "@/api/ethics";
import { LoadingState } from "@/components/LoadingState";
import { canalPath } from "@/lib/canal";
import { EthicsReportPage } from "./EthicsReportPage";
import "./denuncia.css";

/**
 * A entrada do canal de denúncia, sem empresa no endereço.
 *
 * A tela de login não dizia que o canal existe, e quem vai denunciar
 * costuma ser justamente quem não tem conta no portal: terceiro, candidato,
 * quem já saiu. O caminho até aqui é o link "Canal de denúncia" da entrada.
 * [CB-63]
 *
 * O que fazer sem a empresa depende da instalação:
 *
 * - atende uma empresa só: não há escolha a fazer, e esta tela leva direto
 *   ao canal dela;
 * - atende mais de uma: não há como saber de qual empresa é quem está
 *   olhando antes de a pessoa entrar — e ela não vai entrar. Então a tela
 *   oferece o que não depende da empresa (acompanhar um relato, que
 *   protocolo e código bastam) e, para um relato novo, pede o endereço que
 *   a empresa divulgou.
 *
 * Acompanhar não depende da consulta: se ela falhar, a tela abre no mesmo
 * lugar em vez de não abrir.
 */
type Estado =
  | { fase: "carregando" }
  | { fase: "uma-empresa"; id: string }
  | { fase: "sem-empresa" };

export function PublicEthicsHomePage() {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });

  useEffect(() => {
    let cancelado = false;
    fetchEthicsMeta()
      .then((meta) => {
        if (cancelado) return;
        setEstado(
          meta.single_organization
            ? { fase: "uma-empresa", id: meta.single_organization.id }
            : { fase: "sem-empresa" },
        );
      })
      .catch(() => {
        if (!cancelado) setEstado({ fase: "sem-empresa" });
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (estado.fase === "uma-empresa") {
    return <Navigate to={canalPath(estado.id)} replace />;
  }

  return (
    <div className="canal-page">
      <div className="canal-sheet">
        <p className="canal-eyebrow muted">Canal de denúncia</p>
        {estado.fase === "carregando" ? (
          <LoadingState />
        ) : (
          <EthicsReportPage publico semEmpresa />
        )}
      </div>
    </div>
  );
}
