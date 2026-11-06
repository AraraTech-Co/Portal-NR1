-- Data de nascimento na ficha: um dos três dados do primeiro acesso. Coluna
-- nova, vazia nas fichas que já existem. [C1-7]
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "birthDate" TIMESTAMP(3);
