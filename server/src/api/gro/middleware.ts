import { verify } from "../../model/lib/Auth";

/** Leitura — qualquer usuário autenticado na conta. */
export const read = verify("user");

/** Escrita SST — exige permissão `sst` (OWNER/ADMIN/SST). */
export const write = verify("sst");
