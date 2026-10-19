-- O prazo sugerido pelo nível do risco vira limite. [S2-M] [CB-21]
--
-- Passar do limite continua possível — há obra, compra e parada de máquina
-- que não cabem em 30 dias —, mas agora exige dizer por quê, e o motivo fica
-- junto da ação. Data no passado passa a ser recusada.
--
-- Ações que já existem não são tocadas: o limite vale para o que for criado
-- ou ter o prazo alterado daqui em diante.
ALTER TABLE "Action" ADD COLUMN "deadlineJustification" TEXT;
