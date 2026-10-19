-- A turma pode ser marcada antes de acontecer, e quem for convocado é
-- avisado. [CB-34]
--
-- Antes a turma só existia depois da aula: não havia como agendar nem chamar
-- ninguém. O agendamento usa a Convocações, que a empresa já tem; faltava o
-- aviso chegar à pessoa.
ALTER TYPE "NotificationKind" ADD VALUE 'TRAINING_SCHEDULED';
