import { verify } from "../../model/lib/Auth";

/** Qualquer usuário autenticado. */
export const read = verify("user");

/** Escrita de RH (OWNER/ADMIN/RH/MASTER). */
export const writeRh = verify("rh");
