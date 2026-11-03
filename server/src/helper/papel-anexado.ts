import { Evidence } from "../model/schema/Evidence/Evidence";
import { EVIDENCE_TYPES, EVIDENCE_VALIDATION_STATUSES } from "../constants";
import { assertSize, buildEvidenceStoragePath, writeEvidenceFile } from "./uploads";

/**
 * O papel assinado anexado a um registro: o comprovante de ciência da ordem
 * de serviço, a lista de presença da turma. Pela decisão B3-4-F, anexar é
 * possível, não obrigatório — o registro do portal é a prova. [CB-74]
 *
 * Mesma forma do anexo do simulado e da participação: o arquivo vai para o
 * armazenamento privado e a evidência pende do registro por FK.
 */
export class PapelInvalido extends Error {}

export async function gravarPapel(input: {
  organizationId: string;
  uploadedById: string;
  body: unknown;
  eventDate: Date;
  vinculo: { serviceOrderId: string } | { trainingSessionId: string };
}) {
  const { file_name, mime_type, content_base64, description } = (input.body ?? {}) as {
    file_name?: string;
    mime_type?: string;
    content_base64?: string;
    description?: string;
  };
  if (!file_name?.trim() || !mime_type || !content_base64) {
    throw new PapelInvalido("Envie o arquivo do papel assinado.");
  }
  const data = Buffer.from(content_base64, "base64");
  assertSize(data.length || 0);
  const { storagePath, absolutePath } = buildEvidenceStoragePath(input.organizationId, mime_type);
  writeEvidenceFile(absolutePath, data);

  return new Evidence().create.new({
    organizationId: input.organizationId,
    type: EVIDENCE_TYPES.DOCUMENT,
    storagePath,
    fileName: file_name.trim(),
    mimeType: mime_type,
    sizeBytes: data.length,
    description: description?.trim() || null,
    eventDate: input.eventDate,
    uploadedById: input.uploadedById,
    validationStatus: EVIDENCE_VALIDATION_STATUSES.PENDING,
    ...input.vinculo,
  });
}

/** O que a tela precisa de cada papel anexado. */
export const PAPEL_SELECT = {
  id: true,
  fileName: true,
  description: true,
  uploadedAt: true,
} as const;
