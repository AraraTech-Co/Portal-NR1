-- Pedido de entrada com CPF e data de nascimento: a ficha nasce completa na
-- aprovação. Colunas novas, vazias nos pedidos que já existem; quem aprova
-- informa os dois nesses casos. Apagadas quando o pedido é decidido.
ALTER TABLE "AccountJoinRequest" ADD COLUMN IF NOT EXISTS "taxId" TEXT;
ALTER TABLE "AccountJoinRequest" ADD COLUMN IF NOT EXISTS "birthDate" TIMESTAMP(3);
