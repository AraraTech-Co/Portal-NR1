import fs from "fs";
import { Response } from "express";
import { resolveStoragePath } from "./uploads";

const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  mp4: "video/mp4",
};

/**
 * Entrega um arquivo do storage privado para ver na tela (inline): foto,
 * PDF ou vídeo. Quem chama já conferiu a permissão. O tipo vem do que foi
 * gravado no envio (que só aceita jpg/png/webp/pdf/mp4) ou da extensão.
 */
export function sendPrivateFile(
  res: Response,
  file: { storagePath: string | null; fileName: string | null; mimeType?: string | null },
  emptyMessage = "Registro sem arquivo.",
): void {
  const abs = file.storagePath ? resolveStoragePath(file.storagePath) : null;
  if (!abs || !fs.existsSync(abs) || fs.statSync(abs).size === 0) {
    res.status(404).json({ message: emptyMessage });
    return;
  }
  const ext = abs.slice(abs.lastIndexOf(".") + 1).toLowerCase();
  res.setHeader("Content-Type", file.mimeType || TYPE_BY_EXT[ext] || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(file.fileName || `arquivo.${ext}`)}`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(abs)
    .on("error", () => {
      if (!res.headersSent) res.status(500).json({ message: "Falha ao ler o arquivo." });
      else res.destroy();
    })
    .pipe(res);
}
