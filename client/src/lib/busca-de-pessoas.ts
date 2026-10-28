/**
 * A busca de pessoas por nome, matrícula ou função, sem acento e sem
 * diferença de maiúscula.
 *
 * A turma de treinamento tinha a busca; Convocações, não: convocar a CIPA
 * numa empresa de centenas de pessoas era rolar a lista inteira. As duas
 * passam a usar esta mesma. [B3-3-E]
 */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filtrarPessoas<
  T extends { name: string; registration: string | null; jobRoleName: string | null },
>(pessoas: T[], busca: string): T[] {
  const termo = semAcento(busca.trim());
  if (!termo) return pessoas;
  return pessoas.filter((p) =>
    [p.name, p.registration ?? "", p.jobRoleName ?? ""].some((campo) =>
      semAcento(campo).includes(termo),
    ),
  );
}
