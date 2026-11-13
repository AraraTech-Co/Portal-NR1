-- Aviso de documento do RH publicado: à pessoa, à filial ou à empresa. [Item 10, 13/11]
-- Só acrescenta um valor ao enum. Idempotente.

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'HR_DOCUMENT_PUBLISHED';
