/**
 * PDFs mínimos, com texto de verdade, para testar a conferência do holerite.
 * Sem compressão: o leitor (pdfjs) extrai as linhas exatamente como escritas.
 * Dados sempre fictícios — holerite real não entra em teste.
 */
export function pdfBase64(lines: string[]): string {
  const escaped = lines.map((l) => l.replace(/([()\\])/g, "\\$1"));
  const body =
    "BT /F1 10 Tf 40 760 Td 14 TL\n" +
    escaped.map((l) => `(${l}) Tj T*`).join("\n") +
    "\nET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1").toString("base64");
}

/** Holerite no formato da folha: empresa, competência e a linha da pessoa. */
export function holerite(matricula: string, nome: string, competencia: string): string {
  return pdfBase64([
    "0683 - EMPRESA TESTE LTDA",
    competencia,
    "Data do Credito: 05/10/2026",
    `1  ${matricula} - ${nome}   15/01/2024`,
    "Data Admissao",
    "1520 SALARIO BASE   3.000,00",
    "TOTAL LIQUIDO 2.450,00",
  ]);
}
