import { describe, expect, it } from "vitest";
import { lerCaminho } from "../../src/helper/telas-consultadas";

/**
 * O endereço interno vira nome de tela.
 *
 * A lista do que o fiscal abriu mostrava "/api/fiscalizacao" como "Outra
 * consulta", e uma linha para cada consulta que a tela faz sozinha. [B2-4-H]
 */
const UM_ID = "aaaaaaaa-0001-4000-8000-000000000021";

describe("nome da tela a partir da rota [B2-4-H]", () => {
  it("o painel da fiscalização tem nome — era 'Outra consulta'", () => {
    expect(lerCaminho("/api/fiscalizacao").screen).toBe("Painel da fiscalização");
    expect(lerCaminho("/api/fiscalizacao/historico?limit=50").screen).toBe(
      "Painel da fiscalização — histórico",
    );
    expect(lerCaminho("/api/inicio").screen).toBe("Início");
  });

  it("consulta que a tela faz sozinha é marcada como apoio", () => {
    for (const caminho of [
      "/api/notificacoes",
      "/api/establishments",
      "/api/sectors?establishment_id=x",
      "/api/job-roles",
    ]) {
      expect(lerCaminho(caminho).auxiliary, caminho).toBe(true);
    }
  });

  it("tela que o fiscal abre não é apoio", () => {
    for (const caminho of [
      "/api/inventory",
      "/api/actions",
      "/api/pgr-documents",
      "/api/employee-profiles",
    ]) {
      expect(lerCaminho(caminho).auxiliary, caminho).toBe(false);
    }
  });

  it("abrir um registro diz qual é o registro", () => {
    const risco = lerCaminho(`/api/risks/${UM_ID}`);
    expect(risco.entity).toBe("risk");
    expect(risco.entityId).toBe(UM_ID);

    const ficha = lerCaminho(`/api/employee-profiles/${UM_ID}/ficha`);
    expect(ficha.entity).toBe("employee");
    expect(ficha.entityId).toBe(UM_ID);

    const ordem = lerCaminho(`/api/service-orders/${UM_ID}/ciencias`);
    expect(ordem.entity).toBe("service_order");
    expect(ordem.entityId).toBe(UM_ID);
  });

  it("a lista não é um registro", () => {
    const lista = lerCaminho("/api/risks?establishment_id=x");
    expect(lista.entity).toBeNull();
    expect(lista.entityId).toBeNull();
  });

  it("o que não é identificador não vira registro", () => {
    /*
      "/api/trainings/minhas" não é um treinamento: só UUID conta como
      identificador, senão a tela prometeria um nome que não existe.
    */
    const rota = lerCaminho("/api/trainings/minhas");
    expect(rota.entityId).toBeNull();
  });

  it("rota desconhecida continua aparecendo, sem inventar nome", () => {
    const outra = lerCaminho("/api/alguma-coisa-nova");
    expect(outra.screen).toBe("Outra consulta");
    expect(outra.auxiliary).toBe(false);
  });
});
