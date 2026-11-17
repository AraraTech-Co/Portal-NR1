-- Papel "Gerente geral": acima do Gerente e abaixo do RH. Só acrescenta o
-- valor ao enum; nenhuma linha muda.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'GERENTE_GERAL';
