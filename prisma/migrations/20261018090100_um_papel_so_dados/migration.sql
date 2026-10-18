-- Ninguém perde acesso no dia da virada. [OB-3] [S1-C]
--
-- O papel da empresa sobe onde o da conta era o que mandava:
--   OWNER na conta  → OWNER na empresa  (mesma coluna da matriz, mesmo
--                     alcance de uma conta só: ninguém ganha nem perde)
--   ADMIN na conta, e na empresa COLABORADOR, SUPERVISOR ou GERENTE
--                   → ADM_LOJA  (a coluna ADM loja cobre as três)
--   ADMIN na conta, e na empresa RH, SST, ADM_LOJA, ADMIN, MASTER, OWNER ou
--                     FISCAL → fica como está; o papel da empresa é o que vale
--
-- O último caso é o do achado: a partir daqui vale o que todas as telas
-- sempre mostraram. Quem era ADMIN na conta e RH ou SST na empresa troca o
-- acesso de ADM loja pelo de RH ou SST — é a correção, não um efeito dela.
--
-- O vínculo com a conta (AccountMembership) não é tocado: é ele que diz de
-- quais contas a pessoa é membro. O que deixou de valer foi o `role` dele.

UPDATE "Membership" m
   SET "role" = 'OWNER'
  FROM "AccountMembership" am, "Account" a
 WHERE am."userId" = m."userId"
   AND am."accountId" = a."id"
   AND a."organizationId" = m."organizationId"
   AND am."role" = 'OWNER'
   AND m."role" NOT IN ('MASTER', 'OWNER', 'FISCAL');

UPDATE "Membership" m
   SET "role" = 'ADM_LOJA'
  FROM "AccountMembership" am, "Account" a
 WHERE am."userId" = m."userId"
   AND am."accountId" = a."id"
   AND a."organizationId" = m."organizationId"
   AND am."role" = 'ADMIN'
   AND m."role" IN ('COLABORADOR', 'SUPERVISOR', 'GERENTE');

-- E o papel na conta passa a acompanhar o da empresa, para que as duas telas
-- nunca mais mostrem papéis diferentes da mesma pessoa. [S1-C]
UPDATE "AccountMembership" am
   SET "role" = CASE
         WHEN m."role" IN ('MASTER', 'OWNER') THEN 'OWNER'::"AccountRole"
         WHEN m."role" IN ('RH', 'SST', 'GERENTE', 'ADM_LOJA', 'ADMIN')
              THEN 'ADMIN'::"AccountRole"
         ELSE 'USER'::"AccountRole"
       END
  FROM "Account" a, "Membership" m
 WHERE am."accountId" = a."id"
   AND m."userId" = am."userId"
   AND m."organizationId" = a."organizationId";
