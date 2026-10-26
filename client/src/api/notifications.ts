import { request } from "./client";

export type Notification = {
  id: string;
  kind:
    | "ACTION_ASSIGNED"
    | "ANNOUNCEMENT_PUBLISHED"
    | "SERVICE_ORDER_ISSUED"
    | "ACTION_WAITING_VALIDATION"
    | "ACTION_REJECTED"
    | "ACTION_VALIDATED"
    | "PAYSLIP_PUBLISHED"
    | "PAYSLIP_ANSWERED"
    | "CERTIFICATE_REVIEWED"
    | "ETHICS_MESSAGE"
    | "TRAINING_COMPLETED"
    /* Fatos que aconteciam sem aviso nenhum. [CB-29] [CB-53] [B3-3-F] [B3-3-I] */
    | "JOIN_REQUEST_OPENED"
    | "LEAVE_DECIDED"
    | "POINTS_GRANTED"
    | "REWARD_REQUESTED"
    | "SUMMON_OPENED"
    | "ETHICS_REPORT_OPENED";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

/** A caixa de avisos de quem está logado. [S3-A] [S3-G] [S4-G] */
export function fetchNotifications() {
  return request<{ notifications: Notification[]; unread: number }>("/api/notificacoes");
}

export function markNotificationRead(id: string) {
  return request(`/api/notificacoes/${id}/lida`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return request<{ ok: boolean; count: number }>("/api/notificacoes/ler-todas", {
    method: "POST",
  });
}
