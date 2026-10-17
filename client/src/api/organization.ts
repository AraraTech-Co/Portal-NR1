import { request } from "./client";

export type Organization = {
  id: string;
  name: string;
  taxId: string | null;
  responsibleName: string | null;
  responsibleRole: string | null;
  responsibleRegistration: string | null;
  assessmentReviewMonths: number;
  hasSstCertification: boolean;
};

export function fetchOrganization() {
  return request<{
    organization: Organization;
    can_edit: boolean;
    review_months_max: number;
  }>("/api/organizacao");
}

export function updateOrganization(input: {
  name?: string;
  tax_id?: string;
  responsible_name?: string;
  responsible_role?: string;
  responsible_registration?: string;
  assessment_review_months?: number;
  has_sst_certification?: boolean;
}) {
  return request<{ organization: Organization }>("/api/organizacao", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
