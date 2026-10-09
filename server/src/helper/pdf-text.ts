/**
 * Texto de um PDF, para conferir de quem é o holerite.
 *
 * `pdfjs-dist` puro: sem binário nativo e sem rede. Só o texto interessa —
 * nada é renderizado. PDF digitalizado não tem camada de texto e devolve
 * string vazia; quem decide o que fazer com isso é `payslip-check.ts`.
 */

/** Holerite de uma pessoa não tem dez páginas. */
const MAX_PAGES = 10;

export async function extractPdfText(data: Buffer): Promise<string> {
  // Import dinâmico: o pdfjs só é carregado quando alguém publica holerite.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    // Arquivo vindo de fora: não buscamos fonte no sistema.
    useSystemFonts: false,
    // Silencia o aviso de `standardFontDataUrl`: para TEXTO não faz diferença.
    verbosity: 0,
  });

  try {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const parts: string[] = [];
    for (let number = 1; number <= pages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      parts.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
      page.cleanup();
    }
    return parts.join("\n");
  } catch {
    // Corrompido, protegido por senha ou nem é PDF: sem texto, e quem trava é
    // o `checkPayslip`.
    return "";
  } finally {
    // No pdfjs quem se encerra é a TAREFA, não o documento.
    await task.destroy();
  }
}
