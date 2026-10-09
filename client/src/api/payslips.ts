import { getToken } from "./token";
import { request } from "./client";

export type PayslipListItem = {
  id: string;
  userId: string;
  referenceMonth: number;
  referenceYear: number;
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
  fileName: string;
  publishedAt: string;
  viewedAt: string | null;
  user: { id: string; name: string };
  publishedBy: { id: string; name: string };
  questions: PayslipQuestion[];
};

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
}) {
  return request<{ payslip: PayslipDetail; replaced: boolean }>(
    "/api/payslips",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
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

/** iPhone e iPad — o iPadOS se apresenta como Mac, mas tem tela de toque. */
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/** Tempo para o visualizador terminar de carregar antes de liberar o arquivo da memória. */
const REVOKE_AFTER_MS = 60_000;

export async function downloadPayslipFile(id: string, fileName: string) {
  /*
    No iPhone, o Safari abre o PDF na própria aba em vez de baixar — pequeno —
    e o link do arquivo era revogado na mesma hora: ao voltar, o visualizador
    não achava mais o arquivo. [S4-F]

    No iOS, o PDF abre numa aba própria, no visualizador nativo em tela cheia,
    e a aba do portal fica intacta. A aba é aberta AGORA, ainda dentro do
    toque: depois do `await`, o Safari a bloquearia como pop-up.
  */
  const viewer = isIOS() ? window.open("", "_blank") : null;

  let blob: Blob;
  try {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`/api/payslips/${id}/file`, { headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        (data as { message?: string }).message || `Erro ${res.status}`,
      );
    }
    blob = await res.blob();
  } catch (err) {
    viewer?.close();
    throw err;
  }

  const url = URL.createObjectURL(blob);
  if (viewer) {
    viewer.location.href = url;
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Liberado depois que o visualizador carregou — não na mesma hora.
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
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
