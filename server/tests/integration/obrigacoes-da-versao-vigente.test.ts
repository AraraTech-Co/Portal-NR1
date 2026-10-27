import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A nova versão da ordem de serviço começa do texto da vigente.
 *
 * O formulário começava sempre com as quatro frases gerais, qualquer que
 * fosse a função: quem emitia a v2 para acrescentar um risco podia perder o
 * que a v1 pedia ao trabalhador. Agora a nova começa das obrigações e da
 * instrução de emergência da vigente; o texto padrão é só para a primeira.
 * Se a vigente não vier, o texto fica vazio e o erro aparece — cair no padrão
 * seria repetir o problema sem ninguém ver. [B3-4-E]
 *
 * O hook roda sob um React mínimo (abaixo), que implementa a regra
 * documentada do array de dependências: ao re-renderizar, se alguma
 * dependência mudou, roda a limpeza do efeito anterior e o efeito de novo.
 * O que estes casos provam é o comportamento do hook SOB ESSA REGRA, não o
 * do React de verdade em concorrência ou suspense.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */

/* ---- React mínimo ------------------------------------------------------ */

type Efeito = { deps: unknown[] | undefined; limpar?: (() => void) | void };
const estado = {
  slots: [] as unknown[],
  efeitos: [] as Efeito[],
  pendentes: [] as Array<() => void>,
  indice: 0,
  indiceEfeito: 0,
};

vi.mock("../../../client/node_modules/react/index.js", () => ({
  useState<T>(inicial: T) {
    const i = estado.indice++;
    if (!(i in estado.slots)) estado.slots[i] = inicial;
    const set = (v: T | ((a: T) => T)) => {
      estado.slots[i] =
        typeof v === "function" ? (v as (a: T) => T)(estado.slots[i] as T) : v;
    };
    return [estado.slots[i] as T, set];
  },
  useEffect(efeito: () => (() => void) | void, deps?: unknown[]) {
    const i = estado.indiceEfeito++;
    const anterior = estado.efeitos[i];
    const mudou =
      !anterior ||
      deps === undefined ||
      anterior.deps === undefined ||
      deps.length !== anterior.deps.length ||
      deps.some((d, k) => !Object.is(d, anterior.deps![k]));
    if (!mudou) return;
    estado.pendentes.push(() => {
      if (anterior?.limpar) anterior.limpar();
      estado.efeitos[i] = { deps, limpar: efeito() };
    });
  },
}));

import { useTextoDaOrdem } from "../../../client/src/lib/useTextoDaOrdem";
import {
  DEFAULT_DUTIES,
  DEFAULT_EMERGENCY,
  textoDaNovaVersao,
} from "../../../client/src/lib/ordem-de-servico";

function zerar() {
  estado.slots = [];
  estado.efeitos = [];
  estado.pendentes = [];
}

type Args = Parameters<typeof useTextoDaOrdem>;
/** Um "render": zera os índices, chama o hook e aplica os efeitos pendentes. */
function render(...args: Args) {
  estado.indice = 0;
  estado.indiceEfeito = 0;
  const r = useTextoDaOrdem(...args);
  const fila = estado.pendentes.splice(0);
  fila.forEach((f) => f());
  estado.indice = 0;
  estado.indiceEfeito = 0;
  return r;
}

/** Lê o estado atual sem disparar efeitos (deps iguais não re-executam). */
const ler = (...args: Args) => render(...args);

const esperar = () => new Promise((r) => setTimeout(r, 0));

const V1 = {
  version: 1,
  duties: "Usar óculos e luva anticorte na troca de ferramentas.",
  emergencyInstructions: "Parar a máquina pelo botão de emergência.",
};

/* ---- Ajudantes de tela -------------------------------------------------- */

const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

/** O mesmo formato de `rotulos-de-auditoria.test.ts`: bloco, depois linha. */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const fonte = (...c: string[]) =>
  semComentarios(readFileSync(join(CLIENTE, ...c), "utf8"));
const plano = (t: string) => t.replace(/\s+/g, " ");

/* ---- Casos -------------------------------------------------------------- */

describe("o texto com que a próxima versão começa [B3-4-E]", () => {
  it("sem vigente: o texto padrão, sem versão de origem", () => {
    expect(textoDaNovaVersao(null)).toEqual({
      duties: DEFAULT_DUTIES,
      emergency: DEFAULT_EMERGENCY,
      fromVersion: null,
    });
  });

  it("com vigente: as obrigações e a emergência dela, e de qual versão vieram", () => {
    expect(textoDaNovaVersao(V1)).toEqual({
      duties: V1.duties,
      emergency: V1.emergencyInstructions,
      fromVersion: 1,
    });
  });

  it("a vigente sem instrução de emergência continua sem — não ganha a padrão", () => {
    const t = textoDaNovaVersao({ ...V1, emergencyInstructions: null });
    expect(t.emergency).toBe("");
  });
});

describe("o formulário traz o texto da vigente [B3-4-E]", () => {
  beforeEach(zerar);

  it("função sem ordem: começa do padrão, sem buscar nada", () => {
    const buscar = vi.fn();
    render("funcao-a", null, true, buscar);
    const r = ler("funcao-a", null, true, buscar);
    expect(r.duties).toBe(DEFAULT_DUTIES);
    expect(r.fromVersion).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("função com ordem: busca a vigente e começa do texto dela", async () => {
    const buscar = vi.fn().mockResolvedValue(V1);
    const durante = render("funcao-a", "ordem-v1", true, buscar);
    expect(buscar).toHaveBeenCalledWith("ordem-v1");
    expect(ler("funcao-a", "ordem-v1", true, buscar).trazendoTexto).toBe(true);
    expect(durante.duties, "não mostra o padrão enquanto busca").not.toBe(DEFAULT_DUTIES);

    await esperar();
    const r = ler("funcao-a", "ordem-v1", true, buscar);
    expect(r.duties, "a v2 saiu sem o que a v1 pedia").toBe(V1.duties);
    expect(r.emergency).toBe(V1.emergencyInstructions);
    expect(r.fromVersion).toBe(1);
    expect(r.trazendoTexto).toBe(false);
  });

  it("a vigente não veio: texto vazio e o erro aparece, nada de padrão", async () => {
    const buscar = vi.fn().mockRejectedValue(new Error("rede"));
    render("funcao-a", "ordem-v1", true, buscar);
    await esperar();
    const r = ler("funcao-a", "ordem-v1", true, buscar);
    expect(r.duties).toBe("");
    expect(r.duties).not.toBe(DEFAULT_DUTIES);
    expect(r.erroTexto).toMatch(/Não deu para trazer o texto da ordem vigente/);
    expect(r.trazendoTexto).toBe(false);
  });

  it("trocar de função busca a vigente da nova função", async () => {
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(V1)
      .mockResolvedValueOnce({ version: 3, duties: "Da função B.", emergencyInstructions: null });
    render("funcao-a", "ordem-a1", true, buscar);
    await esperar();
    render("funcao-b", "ordem-b3", true, buscar);
    await esperar();
    const r = ler("funcao-b", "ordem-b3", true, buscar);
    expect(buscar).toHaveBeenLastCalledWith("ordem-b3");
    expect(r.duties).toBe("Da função B.");
    expect(r.fromVersion).toBe(3);
  });

  it("a mesma função ganha versão nova: o texto passa a vir dela", async () => {
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(V1)
      .mockResolvedValueOnce({ version: 2, duties: "Texto da v2.", emergencyInstructions: null });
    render("funcao-a", "ordem-v1", true, buscar);
    await esperar();
    /* Outra pessoa emitiu, ou a própria emissão recarregou a lista. */
    render("funcao-a", "ordem-v2", true, buscar);
    await esperar();
    const r = ler("funcao-a", "ordem-v2", true, buscar);
    expect(buscar).toHaveBeenLastCalledWith("ordem-v2");
    expect(r.duties, "a próxima seria a v3 a partir do texto da v1").toBe("Texto da v2.");
    expect(r.fromVersion).toBe(2);
  });

  it("entre duas funções sem ordem, o texto escrito para uma não passa à outra", () => {
    const buscar = vi.fn();
    render("funcao-a", null, true, buscar);
    ler("funcao-a", null, true, buscar).setDuties("Escrito para a função A.");
    render("funcao-b", null, true, buscar);
    const r = ler("funcao-b", null, true, buscar);
    expect(r.duties).toBe(DEFAULT_DUTIES);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("a resposta atrasada da função anterior não sobrescreve a da atual", async () => {
    let soltarA!: (v: typeof V1) => void;
    const lentaA = new Promise<typeof V1>((r) => (soltarA = r));
    const buscar = vi
      .fn()
      .mockReturnValueOnce(lentaA)
      .mockResolvedValueOnce({ version: 2, duties: "Da função B.", emergencyInstructions: null });
    render("funcao-a", "ordem-a1", true, buscar);
    render("funcao-b", "ordem-b2", true, buscar);
    await esperar();
    soltarA(V1);
    await esperar();
    const r = ler("funcao-b", "ordem-b2", true, buscar);
    expect(r.duties, "o texto da função A chegou depois e ficou").toBe("Da função B.");
    expect(r.fromVersion).toBe(2);
  });

  it("re-render sem trocar de função não busca de novo nem apaga o que foi editado", async () => {
    const buscar = vi.fn().mockResolvedValue(V1);
    render("funcao-a", "ordem-v1", true, buscar);
    await esperar();
    ler("funcao-a", "ordem-v1", true, buscar).setDuties("Editado por quem emite.");
    const r = ler("funcao-a", "ordem-v1", true, buscar);
    expect(r.duties).toBe("Editado por quem emite.");
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("função fora da lista (outra unidade escolhida): não troca o texto", () => {
    const buscar = vi.fn();
    render("funcao-sumida", null, false, buscar);
    const r = ler("funcao-sumida", null, false, buscar);
    expect(r.duties, "não pode cair no padrão por a função ter sumido da lista").toBe("");
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("a leitura que o formulário usa traz o texto [B3-4-E]", () => {
  let app: Express;
  let sst: string;

  beforeAll(async () => {
    app = createApp();
    const res = await request(app)
      .post("/api/auth")
      .send({ login: "teste.sst", password: "teste1234" });
    expect(res.status).toBe(200);
    sst = res.body.token as string;
  });

  it("quem emite lê, da vigente, as obrigações e a emergência gravadas", async () => {
    const lista = await request(app)
      .get("/api/service-orders")
      .set({ Authorization: `Bearer ${sst}` });
    expect(lista.status).toBe(200);
    const comOrdem = (
      lista.body.job_roles as Array<{ current: { id: string } | null }>
    ).find((r) => r.current);
    expect(comOrdem, "o seed tem função com ordem emitida").toBeTruthy();

    const res = await request(app)
      .get(`/api/service-orders/${comOrdem!.current!.id}`)
      .set({ Authorization: `Bearer ${sst}` });
    expect(res.status).toBe(200);
    const gravada = await prisma.serviceOrder.findUniqueOrThrow({
      where: { id: comOrdem!.current!.id },
      select: { version: true, duties: true, emergencyInstructions: true },
    });
    expect(res.body.service_order.duties).toBe(gravada.duties);
    expect(res.body.service_order.emergencyInstructions).toBe(gravada.emergencyInstructions);
    expect(res.body.service_order.version).toBe(gravada.version);
  });
});

describe("a tela [B3-4-E]", () => {
  const pagina = fonte("pages", "ServiceOrdersPage.tsx");

  it("o formulário usa o texto da vigente, e o padrão saiu da tela", () => {
    expect(pagina, "o stripper não comeu o código").toContain("function IssueForm(");
    expect(plano(pagina)).toContain(
      "useTextoDaOrdem(jobRoleId, vigenteId, funcaoNaLista, (id) => fetchServiceOrder(id).then((d) => d.service_order), )",
    );
    expect(pagina).toContain("const vigenteId = escolhida?.current?.id ?? null;");
    expect(pagina).not.toContain("DEFAULT_DUTIES");
  });

  it("a função que sai da lista dá lugar à primeira da lista nova", () => {
    expect(plano(pagina)).toContain(
      "const naLista = roles.some((r) => r.id === jobRoleId); if (!naLista && roles[0]) setJobRoleId(roles[0].id);",
    );
  });

  it("enquanto o texto vem, não se edita nem se emite; a tela diz de onde veio", () => {
    const p = plano(pagina);
    expect(p).toContain("<Button type=\"submit\" disabled={saving || trazendoTexto}>");
    expect(p).toContain("value={duties} onChange={(e) => setDuties(e.target.value)} disabled={saving || trazendoTexto}");
    expect(p).toContain("`Texto da v${fromVersion}, a vigente: mude só o que mudou.`");
    expect(p).toContain("{erroTexto && (");
  });
});
