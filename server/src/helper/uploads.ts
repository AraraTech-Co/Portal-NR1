import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
};

export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;

export function uploadsRoot(): string {
  return process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");
}

export function assertAllowedMime(mimeType: string): string {
  const ext = ALLOWED[mimeType];
  if (!ext) {
    throw Object.assign(
      new Error("Tipo de arquivo não permitido (jpg/png/webp/pdf/mp4)."),
      { status: 400 },
    );
  }
  return ext;
}

export function assertSize(sizeBytes: number): void {
  if (sizeBytes < 0 || sizeBytes > MAX_EVIDENCE_BYTES) {
    throw Object.assign(new Error("Arquivo deve ter no máximo 20 MB."), {
      status: 400,
    });
  }
}

/** Caminho relativo privado: {orgId}/evidence/{uuid}{ext} */
export function buildEvidenceStoragePath(
  organizationId: string,
  mimeType: string,
): { storagePath: string; absolutePath: string; ext: string } {
  const ext = assertAllowedMime(mimeType);
  const storagePath = path.posix.join(
    organizationId,
    "evidence",
    `${randomUUID()}${ext}`,
  );
  const absolutePath = path.join(uploadsRoot(), storagePath);
  return { storagePath, absolutePath, ext };
}

export function writeEvidenceFile(absolutePath: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, data);
}
