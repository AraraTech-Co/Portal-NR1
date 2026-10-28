import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";

/**
 * O supertest chama o servidor de teste por `[::1]`.
 *
 * O servidor escuta em `::`, e o supertest chamava `127.0.0.1`: o sistema
 * podia sortear a porta que um proxy local ocupa só em IPv4, e a requisição
 * caía no proxy (407). Pelo `[::1]`, quem atende é sempre o `::` do teste.
 * O ajuste fica em `tests/setup.ts`.
 */
describe("o endereço que o supertest chama", () => {
  it("é [::1], e a requisição chega ao app", async () => {
    const app = express().get("/onde", (req, res) => {
      res.json({ ip: req.socket.remoteAddress });
    });
    const teste = request(app).get("/onde");
    expect((teste as unknown as { url: string }).url).toMatch(/^http:\/\/\[::1\]:\d+\/onde$/);
    const res = await teste;
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe("::1");
  });
});
