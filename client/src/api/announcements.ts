import { request } from "./client";

export type AnnouncementKind = "NOTICE" | "CAMPAIGN" | "TRAINING";

export type AnnouncementListItem = {
  id: string;
  kind: AnnouncementKind | string;
  title: string;
  body: string;
  happensAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  read_at: string | null;
  publishedBy: { id: string; name: string };
  /** As unidades que recebem o aviso. Vazio = a empresa toda. [CB-33] */
  establishments: Array<{ id: string; name: string }>;
  /** Quantas pessoas do público leram, e quantas são. [CB-36] */
  read_count: number;
  audience_count: number;
  /** Quando o texto foi corrigido, e por quem. [S3-I] */
  editedAt?: string | null;
  editedBy?: { id: string; name: string } | null;
  /** Aviso retirado do mural — o registro fica. [S3-I] */
  withdrawnAt?: string | null;
  withdrawnBy?: { id: string; name: string } | null;
  withdrawalReason?: string | null;
};

export function fetchAnnouncements(includeExpired = false) {
  const q = includeExpired ? "?include_expired=true" : "";
  return request<{ announcements: AnnouncementListItem[] }>(
    `/api/announcements${q}`,
  ).then((d) => d.announcements);
}

/** Um aviso só. A lista é que traz a contagem de leitura. */
export function fetchAnnouncement(id: string) {
  return request<{
    announcement: Omit<AnnouncementListItem, "read_count" | "audience_count">;
  }>(
    `/api/announcements/${id}`,
  ).then((d) => d.announcement);
}

export function markAnnouncementRead(id: string) {
  return request<{ read: { readAt: string } }>(
    `/api/announcements/${id}/read`,
    { method: "POST" },
  );
}

export function createAnnouncement(input: {
  kind?: AnnouncementKind;
  title: string;
  body: string;
  happens_at?: string | null;
  expires_at?: string | null;
  /** Vazio ou ausente: o aviso vai para a empresa toda. [CB-33] */
  establishment_ids?: string[];
}) {
  return request<{
    announcement: AnnouncementListItem;
    /** Quantas pessoas receberam o aviso. [CB-33] */
    notified: number;
  }>("/api/announcements", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Corrigir o texto de um aviso publicado. O público não muda: trocar quem
 * recebeu mudaria a quem a empresa comunicou. [S3-I]
 */
export function updateAnnouncement(
  id: string,
  input: { title?: string; body?: string; happens_at?: string | null },
) {
  return request<{ announcement: AnnouncementListItem }>(
    `/api/announcements/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

/** Retirar do mural, com motivo. O registro fica. [S3-I] */
export function withdrawAnnouncement(id: string, reason: string) {
  return request<{ announcement: AnnouncementListItem }>(
    `/api/announcements/${id}/retirar`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export type AnnouncementReader = {
  id: string;
  name: string;
  read_at: string | null;
};

/** Quem leu e quem ainda não leu — para quem publica. [S3-H] */
export function fetchAnnouncementReaders(id: string) {
  return request<{
    announcement: {
      id: string;
      title: string;
      establishments: Array<{ id: string; name: string }>;
    };
    readers: AnnouncementReader[];
    read: number;
    pending: number;
  }>(`/api/announcements/${encodeURIComponent(id)}/leituras`);
}
