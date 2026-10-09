import { getToken } from "@/api/token";

/** Tempo para a outra aba terminar de carregar antes de liberar o arquivo da memória. */
const REVOKE_AFTER_MS = 60_000;

/** Baixa um arquivo que exige login (não dá para usar a URL direto num <img> ou link). */
export async function fetchProtectedBlob(url: string): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || `Erro ${res.status}`);
  }
  return res.blob();
}

/**
 * Abre o arquivo numa aba própria. A aba é aberta AGORA, ainda dentro do
 * clique — depois do `await` o navegador a bloquearia como pop-up.
 */
export async function openProtectedFile(url: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const objectUrl = URL.createObjectURL(await fetchProtectedBlob(url));
    if (tab) {
      tab.location.href = objectUrl;
    } else {
      // Pop-up bloqueado: tenta de novo por link, sem tirar a pessoa do portal.
      const a = document.createElement("a");
      a.href = objectUrl;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_AFTER_MS);
  } catch (err) {
    tab?.close();
    window.alert(err instanceof Error ? err.message : "Não foi possível abrir o arquivo.");
  }
}
