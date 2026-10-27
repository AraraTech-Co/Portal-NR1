import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ParticipationType } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { PARTICIPATION_TYPE_LABEL as ROTULO_DO_SERVIDOR } from "../../src/helper/rotulos";
import { PARTICIPATION_TYPE_LABEL as ROTULO_DA_TELA } from "../../../client/src/lib/labels";

/**
 * O DDS como tipo de participação, e duas correções da ordem impressa.
 *
 * A Participação dizia, com a lista vazia, que "DDS, reuniões e consultas
 * aparecem nesta lista", e não tinha o tipo DDS: o registro ia como
 * "Comunicação de risco". [B3-4-G]
 *
 * Na ordem de serviço impressa, o nível de risco quebrava no meio da
 * palavra, e o comprovante — que sai em folha própria — falava da "ordem de
 * serviço acima". [B3-4-H]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SUFIXO = Date.now().toString(36);
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

let app: Express;
let sst: string;
const criadas: string[] = [];

beforeAll(async () => {
  app = createApp();
  const res = await request(app)
    .post("/api/auth")
    .send({ login: "teste.sst", password: "teste1234" });
  expect(res.status).toBe(200);
  sst = res.body.token as string;
});

afterAll(async () => {
  await prisma.participationRecord.deleteMany({ where: { id: { in: criadas } } });
});

describe("o DDS é um tipo de participação [B3-4-G]", () => {
  it("registrar um DDS pela rota da tela", async () => {
    const res = await request(app)
      .post("/api/participations")
      .set({ Authorization: `Bearer ${sst}` })
      .send({
        type: "SAFETY_DIALOGUE",
        subject: `DDS da proteção da placa ${SUFIXO}`,
        occurred_at: "2026-10-20",
        participants_count: 12,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criadas.push(res.body.participation.id);
    const gravada = await prisma.participationRecord.findUniqueOrThrow({
      where: { id: res.body.participation.id },
      select: { type: true },
    });
    expect(gravada.type).toBe("SAFETY_DIALOGUE");
  });

  it("o filtro por tipo acha o DDS e só ele", async () => {
    const res = await request(app)
      .get("/api/participations?type=SAFETY_DIALOGUE")
      .set({ Authorization: `Bearer ${sst}` });
    expect(res.status).toBe(200);
    const linhas = res.body.participations as Array<{ type: string; subject: string }>;
    expect(linhas.some((p) => p.subject === `DDS da proteção da placa ${SUFIXO}`)).toBe(true);
    expect(linhas.every((p) => p.type === "SAFETY_DIALOGUE")).toBe(true);
  });

  it("a tela e o servidor dão nome ao DDS — e a todos os tipos que o banco aceita", () => {
    expect(ROTULO_DA_TELA.SAFETY_DIALOGUE).toBe("DDS (Diálogo Diário de Segurança)");
    expect(ROTULO_DO_SERVIDOR.SAFETY_DIALOGUE).toBe("DDS (Diálogo Diário de Segurança)");
    /* A lista do formulário sai das chaves do rótulo: tipo sem rótulo não aparece para escolher. */
    expect(Object.keys(ROTULO_DA_TELA).sort()).toEqual(
      Object.values(ParticipationType).sort(),
    );
  });

  it("o formulário oferece os tipos a partir do rótulo", () => {
    const pagina = plano(fonte("pages", "ParticipationsPage.tsx"));
    expect(pagina).toContain("{Object.entries(PARTICIPATION_TYPE_LABEL).map(([v, r]) => (");
    expect(pagina).toContain('emptyDescription="DDS, reuniões e consultas aparecem nesta lista."');
  });
});

describe("a ordem impressa [B3-4-H]", () => {
  const pagina = plano(fonte("pages", "ServiceOrderViewPage.tsx"));

  it("o comprovante se refere à ordem identificada na própria folha", () => {
    expect(pagina, "o stripper não comeu o código").toContain("export function ServiceOrderViewPage");
    expect(pagina).toContain(
      "Declaro que recebi, li e entendi a ordem de serviço identificada nesta folha, que diz a que estou exposto, como me proteger e o que devo fazer.",
    );
    expect(pagina).not.toContain("ordem de serviço acima");
    /* E a folha de fato identifica: função, versão e identificador. */
    expect(pagina).toContain("Ordem de serviço emitida no Portal NR-1 · identificador {order.id}");
  });

  it("o nível sai numa palavra só", () => {
    expect(pagina).toContain(
      '<span className="so-nivel"> {label(RISK_LEVEL_LABEL, r.level)} </span>',
    );
    const css = plano(fonte("pages", "service-orders.css"));
    const regra = css.match(/\.so-nivel \{([^}]*)\}/);
    expect(regra, "a regra .so-nivel existe").not.toBeNull();
    expect(regra![1]).toContain("white-space: nowrap;");
  });
});
