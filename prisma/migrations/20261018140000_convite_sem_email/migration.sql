-- O e-mail deixa de ser obrigatório no cadastro pelo link. [OB-1]
--
-- O portal não envia nem confirma e-mail, e metade do chão de fábrica não tem
-- e-mail corporativo. A planilha já dispensava: eram duas regras diferentes
-- para a mesma coisa.
ALTER TABLE "AccountJoinRequest" ALTER COLUMN "email" DROP NOT NULL;
