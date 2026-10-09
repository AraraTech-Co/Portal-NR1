-- Papel de consulta para a fiscalização: lê, nunca grava. [S7-A]
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FISCAL';
