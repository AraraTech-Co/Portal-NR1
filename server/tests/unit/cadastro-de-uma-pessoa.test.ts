import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chaveDoFormulario,
  faltaNoFormulario,
  FORMULARIO_VAZIO,
  funcoesDaFilial,
  papeisDoFormulario,
  pessoaDoFormulario,
} from "../../../client/src/lib/cadastro-de-uma-pessoa";

/** O formulário "Cadastrar uma pessoa" de Conta e usuários. */
const ok = { ...FORMULARIO_VAZIO, nome: "Ana", nascimento: "1990-05-10", cpf: "52998224725" };

describe("o que o formulário exige", () => {
  it("nome, nascimento e CPF ou matrícula", () => {
    expect(faltaNoFormulario(ok, 1)).toBeNull();
    expect(faltaNoFormulario({ ...ok, nome: " " }, 1)).toBe("Informe o nome.");
    expect(faltaNoFormulario({ ...ok, nascimento: "" }, 1)).toMatch(/^Informe a data de nascimento/);
    expect(faltaNoFormulario({ ...ok, cpf: "" }, 1)).toMatch(/^Informe o CPF ou a matrícula/);
    expect(faltaNoFormulario({ ...ok, cpf: "", matricula: "1023" }, 1)).toBeNull();
  });

  it("a filial com mais de uma na empresa, e a contratada para terceirizado", () => {
    expect(faltaNoFormulario(ok, 2)).toBe("Escolha a filial.");
    expect(faltaNoFormulario({ ...ok, filialId: "f1" }, 2)).toBeNull();
    expect(faltaNoFormulario({ ...ok, vinculo: "CONTRACTOR" }, 1)).toBe("Escolha a empresa contratada.");
    expect(faltaNoFormulario({ ...ok, vinculo: "CONTRACTOR", contratadaId: "c1" }, 1)).toBeNull();
  });
});

describe("a pessoa que vai para a rota", () => {
  it("só o preenchido, aparado; a contratada só com terceirizado", () => {
    expect(pessoaDoFormulario({ ...ok, nome: " Ana ", matricula: " ", contratadaId: "c1" })).toEqual({
      name: "Ana",
      birth_date: "1990-05-10",
      tax_id: "52998224725",
      org_role: "COLABORADOR",
      bond: "EMPLOYEE",
    });
    expect(pessoaDoFormulario({ ...ok, vinculo: "CONTRACTOR", contratadaId: "c1" }).contractor_id).toBe("c1");
  });

  it("mudar qualquer campo muda a chave do que foi conferido", () => {
    expect(chaveDoFormulario(ok)).toBe(chaveDoFormulario({ ...ok }));
    expect(chaveDoFormulario({ ...ok, cpf: "11144477735" })).not.toBe(chaveDoFormulario(ok));
    expect(chaveDoFormulario({ ...ok, funcaoId: "j1" })).not.toBe(chaveDoFormulario(ok));
  });
});

describe("as listas", () => {
  it("as funções da filial escolhida; sem filial, nenhuma", () => {
    const funcoes = [
      { id: "a", establishment: { id: "f1" } },
      { id: "b", establishment: { id: "f2" } },
      { id: "c" },
    ];
    expect(funcoesDaFilial(funcoes, "f1").map((f) => f.id)).toEqual(["a"]);
    expect(funcoesDaFilial(funcoes, "")).toEqual([]);
  });

  it("Fiscal fora dos papéis", () => {
    expect(papeisDoFormulario(["COLABORADOR", "FISCAL", "RH"])).toEqual(["COLABORADOR", "RH"]);
  });
});

describe("a tela", () => {
  const tela = readFileSync(join(__dirname, "../../../client/src/pages/CadastrarUmaPessoa.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const conta = readFileSync(join(__dirname, "../../../client/src/pages/AccountPage.tsx"), "utf8");

  it("Cadastrar só depois de um Conferir sem erro, com os mesmos dados, e travado no envio", () => {
    expect(tela).toMatch(/const valeConferido = conferido !== null && conferido\.chave === chave;/);
    expect(tela).toMatch(/const podeCadastrar = valeConferido && conferido!\.resultado\.status !== "error" && !enviando;/);
    expect(tela).toMatch(/async function cadastrar\(\) \{\s*if \(!podeCadastrar\) return;/);
    expect(tela).toMatch(/disabled=\{!podeCadastrar\}/);
  });

  it("mudar um campo apaga a conferência, e trocar a filial limpa a função", () => {
    expect(tela).toMatch(/\.\.\.\(campo === "filialId" \? \{ funcaoId: "" \} : \{\}\),\s*\}\)\);\s*setConferido\(null\);/);
  });

  it("a mensagem final usa o login da resposta do cadastro", () => {
    expect(tela).toMatch(/const r = await cadastrarUmaPessoa\(pessoaDoFormulario\(form\), false\);\s*const resultado = r\.results\[0\]!;/);
    expect(tela).toMatch(/Login: \$\{resultado\.login\}/);
  });

  it("as funções e os papéis vêm filtrados, e a tela está em Conta e usuários", () => {
    expect(tela).toMatch(/funcoesDaFilial\(funcoes, form\.filialId\)/);
    expect(tela).toMatch(/setPodeDar\(papeisDoFormulario\(p\.assignable\.org_roles\)\)/);
    expect(tela).toMatch(/const falta = faltaNoFormulario\(form, filiais\.length\);\s*if \(falta\) \{/);
    expect(conta).toMatch(/<CadastrarUmaPessoa onCadastrada=\{\(\) => setVersaoDasPessoas\(\(v\) => v \+ 1\)\} \/>/);
    expect(conta).toMatch(/<PessoasEAcessos key=\{versaoDasPessoas\} \/>/);
  });
});
