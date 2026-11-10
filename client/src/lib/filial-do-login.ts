import { useEffect, useState } from "react";
import { EXTERNO, fetchLoginEstablishments } from "@/api/auth";

/**
 * As opções de "Onde você trabalha" na entrada e no primeiro acesso, e a
 * última escolhida neste aparelho (conveniência: quem usa o celular da loja
 * não precisa escolher toda vez). [C3-2b]
 */
const CHAVE = "nr1.filial-do-login";

export function lembrarFilial(id: string) {
  try {
    localStorage.setItem(CHAVE, id);
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

function filialLembrada(): string {
  try {
    return localStorage.getItem(CHAVE) ?? "";
  } catch {
    return "";
  }
}

export function useFiliaisDoLogin(comExterno: boolean) {
  const [filiais, setFiliais] = useState<{ id: string; name: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [escolhida, setEscolhida] = useState("");

  useEffect(() => {
    let vivo = true;
    fetchLoginEstablishments()
      .then((d) => {
        if (!vivo) return;
        setFiliais(d.establishments);
        const lembrada = filialLembrada();
        const valida =
          d.establishments.some((f) => f.id === lembrada) || (comExterno && lembrada === EXTERNO);
        if (valida) setEscolhida(lembrada);
        else if (d.establishments.length === 1) setEscolhida(d.establishments[0].id);
        else if (d.establishments.length === 0 && comExterno) setEscolhida(EXTERNO);
      })
      .catch(() => {
        if (vivo && comExterno) setEscolhida(EXTERNO);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [comExterno]);

  return { filiais, carregando, escolhida, setEscolhida };
}
