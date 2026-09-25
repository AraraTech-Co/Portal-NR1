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
  _count: { reads: number };
};

export function fetchAnnouncements(includeExpired = false) {
  const q = includeExpired ? "?include_expired=true" : "";
  return request<{ announcements: AnnouncementListItem[] }>(
    `/api/announcements${q}`,
  ).then((d) => d.announcements);
}

export function fetchAnnouncement(id: string) {
  return request<{ announcement: AnnouncementListItem }>(
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
}) {
  return request<{ announcement: AnnouncementListItem }>("/api/announcements", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((d) => d.announcement);
}
