import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

if (!process.env.TOKEN_SECRET) {
  process.env.TOKEN_SECRET = "test-token-secret";
}

/*
  O supertest sobe o app com `listen(0)`, que escuta em `::`, e chama
  `127.0.0.1`. Escutar em `::` não conflita com uma porta que outro processo
  ocupa só em IPv4 — um proxy local, por exemplo —, então o sistema podia
  sortear justamente essa porta, e a requisição caía no outro processo (no
  sandbox, um 407 a cada rodada, em caso diferente). A requisição passa a ir
  para `[::1]`: o `::` atende ali, e o processo que só escuta em IPv4, não.
  O servidor continua escutando como antes; só o endereço chamado muda.
*/
import { createRequire } from "node:module";

type TestDoSupertest = { prototype: { serverAddress(app: unknown, path: string): string } };
const Test = createRequire(import.meta.url)("supertest/lib/test") as TestDoSupertest;
const enderecoOriginal = Test.prototype.serverAddress;
Test.prototype.serverAddress = function (app: unknown, path: string) {
  const url = enderecoOriginal.call(this, app, path);
  const escuta = (app as { address?: () => { address?: string } | string | null }).address?.();
  const emTodos = typeof escuta === "object" && escuta?.address === "::";
  return emTodos ? url.replace(/^(https?:\/\/)127\.0\.0\.1:/, "$1[::1]:") : url;
};
