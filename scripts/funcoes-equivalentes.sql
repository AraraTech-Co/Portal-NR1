-- Funções ativas que passam a ser equivalentes pela chave do cargo (Correção 6, C6-1).
--
-- Só lê: não grava nada. Rodar no banco ANTES do deploy da Correção 6.
-- Cada linha é um grupo de funções da mesma filial com a mesma chave
-- ("Repositor" e "Repositora", "Auxiliar Administrativa" e "Auxiliar
-- Administrativo"). Depois do deploy, a planilha recusa as linhas desse cargo
-- com "há duas funções equivalentes", até uma delas ser arquivada.
-- Sem linhas na saída: nada a fazer.
--
-- A chave é a mesma de `chaveDoCargo` (server/src/helper/chave-do-cargo.ts):
-- sem acento, minúsculas, o que não é letra nem número vira espaço, e em cada
-- palavra "...ora" vira "...or" e "...a" vira "...o".

WITH funcoes AS (
  SELECT
    e."id"   AS filial_id,
    e."name" AS filial,
    s."name" AS setor,
    f."id"   AS funcao_id,
    f."name" AS funcao,
    regexp_replace(
      lower(translate(f."name",
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
      '[^a-z0-9]+', ' ', 'g') AS limpo
  FROM "JobRole" f
  JOIN "Sector" s ON s."id" = f."sectorId"
  JOIN "Establishment" e ON e."id" = s."establishmentId"
  WHERE f."archivedAt" IS NULL
    AND s."archivedAt" IS NULL
    AND e."archivedAt" IS NULL
),
com_chave AS (
  SELECT
    funcoes.*,
    (
      SELECT string_agg(
        CASE
          WHEN p LIKE '%ora' THEN left(p, -1)
          WHEN p LIKE '%a' THEN left(p, -1) || 'o'
          ELSE p
        END, ' ' ORDER BY n)
      FROM regexp_split_to_table(btrim(limpo), ' +') WITH ORDINALITY AS t(p, n)
      WHERE p <> ''
    ) AS chave
  FROM funcoes
)
SELECT
  filial,
  chave,
  count(*) AS funcoes,
  string_agg(funcao || ' (setor ' || setor || ')', '; ' ORDER BY funcao) AS quais
FROM com_chave
GROUP BY filial_id, filial, chave
HAVING count(*) > 1
ORDER BY filial, chave;
