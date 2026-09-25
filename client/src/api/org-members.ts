import { request } from "./client";

export type OrgMember = {
  id: string;
  name: string;
  login: string;
  jobRoleName: string | null;
  registration: string | null;
};

export function fetchOrgMembers() {
  return request<{ members: OrgMember[] }>("/api/org-members").then(
    (d) => d.members,
  );
}
