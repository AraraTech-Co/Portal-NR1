import { getToken } from "./token";

/** iPhone e iPad — o iPadOS se apresenta como Mac, mas tem tela de toque. */
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/** Tempo para o visualizador terminar de carregar antes de liberar o arquivo da memória. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Baixa um arquivo que só sai com o acesso da pessoa (holerite, evidência,
 * ata do simulado) e o entrega ao navegador.
 *
 * Era a mesma rotina escrita dentro do holerite; a participação e o simulado
 * precisam dela também, e copiar trinta linhas três vezes é como se perde o
 * cuidado do iOS abaixo. [B3-4-B]
 *
 * No iPhone, o Safari abre o PDF na própria aba em vez de baixar, e o endereço
 * temporário do arquivo era revogado na mesma hora: ao voltar, o visualizador
 * não achava mais nada. [S4-F] Por isso a aba é aberta AGORA, ainda dentro do
 * toque — depois do `await` o Safari a bloquearia como pop-up — e o endereço
 * só é liberado um minuto depois.
 */
export async function baixarArquivoPrivado(url: string, fileName: string) {
  const viewer = isIOS() ? window.open("", "_blank") : null;

  let blob: Blob;
  try {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        (data as { message?: string }).message || `Erro ${res.status}`,
      );
    }
    blob = await res.blob();
  } catch (err) {
    viewer?.close();
    throw err;
  }

  const objectUrl = URL.createObjectURL(blob);
  if (viewer) {
    viewer.location.href = objectUrl;
  } else {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Liberado depois que o visualizador carregou — não na mesma hora.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_AFTER_MS);
}
