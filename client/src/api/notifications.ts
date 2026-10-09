import { request } from "./client";

export type Notification = {
  id: string;
  kind: "ACTION_ASSIGNED" | "ANNOUNCEMENT_PUBLISHED";
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
