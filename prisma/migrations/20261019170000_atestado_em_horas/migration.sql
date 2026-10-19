-- O atestado passa a aceitar horas, além de dias. [S5-C]
--
-- Só havia dias: uma declaração de comparecimento de duas horas virava "1 dia"
-- de afastamento na ficha da pessoa. Agora, quando o documento fala em horas,
-- elas entram aqui e os dias ficam em 0.
--
-- Atestados que já existem não mudam: continuam medidos em dias.
ALTER TABLE "MedicalCertificate" ADD COLUMN "hours" INTEGER;
