import { useEffect, useState } from "react";
import { textoDaNovaVersao } from "./ordem-de-servico";

type Vigente = {
  version: number;
  duties: string;
  emergencyInstructions: string | null;
};

/**
 * O texto da próxima ordem de serviço da função escolhida.
 *
 * Ao escolher a função, o texto começa do que a ordem vigente pede ao
 * trabalhador; só a primeira ordem da função começa do padrão. Se a vigente
 * não vier, o texto fica vazio e o erro aparece: cair no padrão seria
 * perder, calado, o que a vigente pedia. [B3-4-E]
 *
 * `buscar` é a leitura da ordem (`fetchServiceOrder`), recebida de fora para
 * o teste poder trocá-la; fica fora das dependências porque é sempre a mesma
 * função do módulo.
 */
export function useTextoDaOrdem(
  jobRoleId: string,
  vigenteId: string | null,
  funcaoNaLista: boolean,
  buscar: (id: string) => Promise<Vigente>,
) {
  const [duties, setDuties] = useState("");
  const [emergency, setEmergency] = useState("");
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [trazendoTexto, setTrazendoTexto] = useState(false);
  const [erroTexto, setErroTexto] = useState<string | null>(null);

  useEffect(() => {
    if (!jobRoleId || !funcaoNaLista) return;
    let cancelado = false;
    setErroTexto(null);
    if (!vigenteId) {
      const t = textoDaNovaVersao(null);
      setDuties(t.duties);
      setEmergency(t.emergency);
      setFromVersion(t.fromVersion);
      setTrazendoTexto(false);
      return;
    }
    setTrazendoTexto(true);
    buscar(vigenteId)
      .then((vigente) => {
        if (cancelado) return;
        const t = textoDaNovaVersao(vigente);
        setDuties(t.duties);
        setEmergency(t.emergency);
        setFromVersion(t.fromVersion);
      })
      .catch(() => {
        if (cancelado) return;
        setDuties("");
        setEmergency("");
        setFromVersion(null);
        setErroTexto(
          "Não deu para trazer o texto da ordem vigente. Recarregue a página antes de emitir.",
        );
      })
      .finally(() => {
        if (!cancelado) setTrazendoTexto(false);
      });
    return () => {
      cancelado = true;
    };
  }, [jobRoleId, vigenteId, funcaoNaLista]);

  return {
    duties,
    setDuties,
    emergency,
    setEmergency,
    fromVersion,
    trazendoTexto,
    erroTexto,
  };
}
