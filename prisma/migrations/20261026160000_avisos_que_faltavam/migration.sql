-- Acontecimentos que ninguém era avisado: o pedido de entrada ficava parado
-- até alguém lembrar de olhar, as férias decididas só apareciam na tela de
-- Férias, os pontos e o resgate não chegavam a ninguém, a convocação não
-- avisava o convocado e a denúncia nova não avisava o comitê.
-- [CB-53] [B3-3-I] [B3-3-F] [CB-64] [CB-29]
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'JOIN_REQUEST_OPENED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'LEAVE_DECIDED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'POINTS_GRANTED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'REWARD_REQUESTED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SUMMON_OPENED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ETHICS_REPORT_OPENED';
