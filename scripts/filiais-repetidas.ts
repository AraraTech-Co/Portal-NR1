/**
 * Só leitura: lista as filiais que já se repetem, antes do deploy da regra
 * "filial sem duplicar" (23/11/2026). Usa a MESMA normalização de nome do
 * portal (server/src/helper/nome.ts). Não grava nada.
 *
 * - Nome repetido entre as filiais ATIVAS da mesma empresa.
 * - CNPJ repetido entre TODAS as filiais da mesma empresa, ativas ou não.
 *
 * Uso: DATABASE_URL=... npx tsx scripts/filiais-repetidas.ts
 */
import { PrismaClient } from "@prisma/client";
import { nomeNormalizado } from "../server/src/helper/nome";

const prisma = new PrismaClient();

async function main() {
  const filiais = await prisma.establishment.findMany({
    select: { id: true, organizationId: true, name: true, taxId: true, archivedAt: true },
    orderBy: [{ organizationId: "asc" }, { name: "asc" }],
  });
  const grupos = (chave: (f: (typeof filiais)[number]) => string | null) => {
    const mapa = new Map<string, typeof filiais>();
    for (const f of filiais) {
      const k = chave(f);
      if (!k) continue;
      mapa.set(k, [...(mapa.get(k) ?? []), f]);
    }
    return [...mapa.values()].filter((g) => g.length > 1);
  };
  const porNome = grupos((f) => (f.archivedAt ? null : `${f.organizationId}|${nomeNormalizado(f.name)}`));
  const porCnpj = grupos((f) => (f.taxId ? `${f.organizationId}|${f.taxId.replace(/\D/g, "")}` : null));
  const linha = (f: (typeof filiais)[number]) =>
    `  ${f.id}  ${f.name}${f.archivedAt ? " (arquivada)" : ""}  empresa ${f.organizationId}`;

  console.log(`Nome repetido entre filiais ativas: ${porNome.length} grupo(s)`);
  for (const g of porNome) console.log(g.map(linha).join("\n") + "\n");
  console.log(`CNPJ repetido entre filiais: ${porCnpj.length} grupo(s)`);
  for (const g of porCnpj) console.log(g.map(linha).join("\n") + "\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
