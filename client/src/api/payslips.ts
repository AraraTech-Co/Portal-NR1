import { getToken } from "./token";
import { request } from "./client";
import { baixarArquivoPrivado } from "./arquivo-privado";

export type PayslipListItem = {
  id: string;
  userId: string;
  referenceMonth: number;
  referenceYear: number;
  /** Mensal, adiantamento, férias, 13º ou rescisão. [B4-G] */
  kind: string;
  fileName: string;
  publishedAt: string;
  viewedAt: string | null;
  user: { id: string; name: string };
  publishedBy: { id: string; name: string };
  _count: { questions: number };
  open_questions: number;
};

export type PayslipQuestion = {
  id: string;
  body: string;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
  askedBy: { id: string; name: string };
  answeredBy: { id: string; name: string } | null;
};

export type PayslipDetail = {
  id: string;
  userId: string;
  referenceMonth: number;
  referenceYear: number;
  kind: string;
  fileName: string;
  publishedAt: string;
  viewedAt: string | null;
  user: { id: string; name: string };
  publishedBy: { id: string; name: string };
  questions: PayslipQuestion[];
  /** Publicado fora do padrão da conferência, com motivo e autor. [CB-28] */
  overrideReason: string | null;
  overriddenBy: { id: string; name: string } | null;
  /** As versões que foram substituídas. [S5-F] */
  versions: Array<{
    id: string;
    fileName: string;
    publishedAt: string;
    viewedAt: string | null;
    replacedAt: string;
    replacedBy: { id: string; name: string };
  }>;
};

/** Baixa a versão que foi substituída — a que a pessoa viu antes. [S5-F] */
export async function downloadPayslipVersion(
  payslipId: string,
  versionId: string,
  fileName: string,
) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(
    `/api/payslips/${payslipId}/versoes/${versionId}/file`,
    { headers },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { message?: string }).message || `Erro ${res.status}`,
    );
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function fetchPayslipRecipients() {
  return request<{
    recipients: Array<{ id: string; name: string; login: string }>;
  }>("/api/payslips/recipients").then((d) => d.recipients);
}

export type OpenPayslipQuestion = {
  id: string;
  body: string;
  created_at: string;
  asked_by: { id: string; name: string };
  payslip_id: string;
  reference_month: number;
  reference_year: number;
  kind: string;
  file_name: string;
  user: { id: string; name: string };
};

export function fetchOpenPayslipQuestions() {
  return request<{ questions: OpenPayslipQuestion[] }>(
    "/api/payslips/open-questions",
  ).then((d) => d.questions);
}

export function fetchPayslips(year?: number) {
  const q = year ? `?year=${year}` : "";
  return request<{ payslips: PayslipListItem[] }>(`/api/payslips${q}`).then(
    (d) => d.payslips,
  );
}

export function fetchPayslip(id: string) {
  return request<{ payslip: PayslipDetail }>(`/api/payslips/${id}`).then(
    (d) => d.payslip,
  );
}

export function publishPayslip(input: {
  user_id: string;
  reference_month: number;
  reference_year: number;
  file_name: string;
  mime_type: string;
  content_base64: string;
  /** Por que publicar apesar de o documento não conferir. [CB-28] */
  override_reason?: string;
  /** Mensal, adiantamento, férias, 13º ou rescisão. [B4-G] */
  kind: string;
}) {
  return request<{
    payslip: PayslipDetail;
    replaced: boolean;
    overridden_reasons: string[];
  }>(
    "/api/payslips",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

/** Como cada parte da folha saiu da conferência. [B4-F] */
export type PayslipBatchPart = {
  pages: number[];
  registration: string | null;
  document_name: string | null;
  situacao:
    | "CONFERE"
    | "SEM_CADASTRO"
    | "NAO_CONFERE"
    | "SEM_FUNCIONARIO"
    | "VARIAS_PESSOAS"
    | "REPETIDA";
  user_id: string | null;
  user_name: string | null;
  substitui: boolean;
  motivos: string[];
  avisos: string[];
};

export type PayslipBatchSummary = {
  conferem: number;
  substituem: number;
  de_fora: number;
  paginas_sem_funcionario: number;
};

type PayslipBatchInput = {
  reference_month: number;
  reference_year: number;
  kind: string;
  file_name: string;
  mime_type: string;
  content_base64: string;
};

/** Confere a folha do mês sem gravar nada. [B4-F] */
export function previewPayslipBatch(input: PayslipBatchInput) {
  return request<{
    total_pages: number;
    resumo: PayslipBatchSummary;
    parts: PayslipBatchPart[];
  }>("/api/payslips/lote/previa", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Publica as partes da folha que conferem; o servidor confere de novo. [B4-F] */
export function publishPayslipBatch(input: PayslipBatchInput) {
  return request<{
    publicados: number;
    substituidos: number;
    resumo: PayslipBatchSummary;
    parts: PayslipBatchPart[];
  }>("/api/payslips/lote", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function askPayslipQuestion(id: string, body: string) {
  return request<{ question: PayslipQuestion }>(
    `/api/payslips/${id}/questions`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );
}

export function answerPayslipQuestion(
  payslipId: string,
  questionId: string,
  answer: string,
) {
  return request<{ question: PayslipQuestion }>(
    `/api/payslips/${payslipId}/questions/${questionId}/answer`,
    {
      method: "POST",
      body: JSON.stringify({ answer }),
    },
  );
}

/**
 * Abre o holerite. O GET marca "Visto" no servidor — é o documento aberto que
 * conta, não a tela. [S4-E]
 */
export async function downloadPayslipFile(id: string, fileName: string) {
  await baixarArquivoPrivado(`/api/payslips/${id}/file`, fileName);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    reader.readAsDataURL(file);
  });
}
