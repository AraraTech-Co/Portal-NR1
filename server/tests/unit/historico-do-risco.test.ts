import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeChange, FIELD_LABEL, humanValue } from "../../../client/src/lib/historico-do-risco";

/**
 * O Histórico do risco sem códigos nem nomes internos. [B4-A]
 *
 * Saíam "tipo: DANGEROUS_EVENT" em "Ocorrência registrada", "afterValidation:
 * vazio → true" no critério registrado depois da validação e
 * "effectivenessResult: …" na ação validada.
 */
describe("o que a trilha guarda, como gente lê [B4-A]", () => {
  it("o tipo da ocorrência sai por extenso", () => {
    expect(describeChange(null, { type: "DANGEROUS_EVENT" })).toEqual(["tipo: Quase aconteceu algo grave"]);
  });

  it("o critério registrado depois da validação diz sim, não true", () => {
    expect(
      describeChange(
        { effectivenessCriteria: null },
        { effectivenessCriteria: "Zero projeções em 60 dias", afterValidation: true },
      ),
    ).toEqual([
      "critério de eficácia: vazio → Zero projeções em 60 dias",
      "registrado depois da validação: vazio → sim",
    ]);
    expect(humanValue(false)).toBe("não");
  });

  it("o resultado da eficácia tem nome", () => {
    expect(describeChange(null, { effectivenessResult: "Sem projeções desde a troca" })).toEqual([
      "resultado da eficácia: Sem projeções desde a troca",
    ]);
  });

  it("a ocorrência registrada traz o que aconteceu e quando", () => {
    expect(
      describeChange(null, {
        type: "ACCIDENT",
        description: "Peça projetada do torno",
        occurredAt: "2026-10-22T13:00:00.000Z",
      }),
    ).toEqual([
      "tipo: Acidente",
      "descrição: Peça projetada do torno",
      "quando aconteceu: 22/10/2026",
    ]);
  });

  it("nenhum campo gravado pelas trilhas do risco sai com o nome do banco", () => {
    /*
      Os campos das trilhas que o Histórico do risco junta: risco, perigo,
      atividade, ação (com prova e validação) e ocorrência. Campo terminado em
      Id é filtrado de propósito.
    */
    const raiz = join(__dirname, "..", "..", "src", "controller");
    const campos = new Set<string>();
    for (const arquivo of [
      "RiskController.ts",
      "WorkplaceController.ts",
      "OccurrenceController.ts",
      "ActionEvidenceController.ts",
    ]) {
      const fonte = readFileSync(join(raiz, arquivo), "utf8");
      /* As chamadas, não a definição do auxiliar; só chave de objeto. */
      for (const m of fonte.matchAll(/(?<!function )\b(?:audit|writeAudit)\(([\s\S]*?)\);/g)) {
        for (const k of m[1]!.matchAll(/[{,]\s*([a-z][A-Za-z]+)\s*:/g)) campos.add(k[1]!);
      }
    }
    const daTrilha = new Set([
      "organizationId",
      "actorId",
      "action",
      "entityType",
      "entityId",
      "before",
      "after",
      "context",
    ]);
    /* A varredura acha o que existe: sem isso, lista vazia passaria. */
    for (const conhecido of ["afterValidation", "effectivenessResult", "exposedWorkersCount", "title"]) {
      expect(campos.has(conhecido), conhecido).toBe(true);
    }
    const semNome = [...campos].filter(
      (k) => !daTrilha.has(k) && !k.endsWith("Id") && !FIELD_LABEL[k],
    );
    expect(semNome).toEqual([]);
  });
});
