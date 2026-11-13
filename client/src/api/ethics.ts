import { request } from "./client";

export type EthicsCategory = { id: string };

/** Com a empresa, o canal público sabe de quem é antes de alguém escrever. [S4-L] */
export function fetchEthicsMeta(organizationId?: string) {
  const qs = organizationId
    ? `?organization_id=${encodeURIComponent(organizationId)}`
    : "";
  return request<{
    categories: EthicsCategory[];
    statuses: EthicsCategory[];
    organization: { id: string; name: string } | null;
    /**
     * A empresa quando esta instalação atende uma só — e nulo quando atende
     * mais de uma, caso em que nenhum nome vem. É o que a entrada do canal
     * precisa para saber se há escolha a fazer. [CB-63]
     */
    single_organization: { id: string; name: string } | null;
    /** As unidades para quem relata escolher (só id e nome). [C1-3] */
    establishments: Array<{ id: string; name: string }>;
  }>(`/api/ethics-reports/meta${qs}`);
}

export function createEthicsReport(input: {
  category: string;
  description: string;
  is_anonymous: boolean;
  /** Onde o fato aconteceu — obrigatório. [C1-3] */
  establishment_id: string;
  /** Fora do portal não há sessão: a empresa vem do link. [S4-L] */
  organization_id?: string;
  /**
   * "Alguém do comitê de ética está envolvido?" Quando sim, o caso não vai
   * ao comitê: fica com o dono ou o master até a triagem. [B3-3-H]
   */
  committee_involved?: boolean;
}) {
  return request<{
    report: {
      id: string;
      protocol: string;
      category: string;
      description: string;
      isAnonymous: boolean;
      status: string;
    };
    access_code: string;
    message: string;
  }>("/api/ethics-reports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function trackEthicsReport(input: {
  protocol: string;
  access_code: string;
}) {
  return request<{
    report: {
      id: string;
      protocol: string;
      category: string;
      description: string;
      isAnonymous: boolean;
      status: string;
      resolutionNote: string | null;
      resolvedAt: string | null;
      /** Quando quem denunciou deu ciência do encerramento. [C1-5] */
      reporterAckAt: string | null;
      messages: Array<{
        id: string;
        side: string;
        body: string;
        createdAt: string;
      }>;
    };
  }>("/api/ethics-reports/track", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** O acompanhamento, como o protocolo e o código o devolvem. */
export type AcompanhamentoDaDenuncia = Awaited<ReturnType<typeof trackEthicsReport>>["report"];

/**
 * As próprias denúncias identificadas, na conta de quem denunciou: sem
 * protocolo e código. A anônima nunca aparece (desenho de 13/11).
 */
export function fetchMyEthicsReports() {
  return request<{
    reports: Array<{
      id: string;
      protocol: string;
      category: string;
      status: string;
      createdAt: string;
      reporterAckAt: string | null;
      /** Mensagens do comitê ainda não lidas. */
      unread: number;
    }>;
  }>("/api/ethics-reports/minhas");
}

export function fetchMyEthicsReport(id: string) {
  return request<{ report: AcompanhamentoDaDenuncia }>(`/api/ethics-reports/minhas/${id}`);
}

/** Resposta ao comitê pela conta: a mensagem continua sem autor. */
export function sendMyEthicsMessage(id: string, body: string) {
  return request<{ message: { id: string } }>(`/api/ethics-reports/minhas/${id}/mensagens`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function acknowledgeMyEthicsReport(id: string, comment?: string) {
  return request<{ reporterAckAt: string }>(`/api/ethics-reports/minhas/${id}/ciencia`, {
    method: "POST",
    body: JSON.stringify(comment ? { comment } : {}),
  });
}

/** Denunciante responde ao comitê, pelo protocolo e código. Nada o identifica. [S5-P] */
export function sendReporterMessage(input: { protocol: string; access_code: string; body: string }) {
  return request<{ message: { id: string; side: string; body: string; createdAt: string } }>(
    "/api/ethics-reports/messages",
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * Quem denunciou dá ciência do encerramento, pelo protocolo e código.
 * Ciência não é concordância; vale uma vez só. [C1-5]
 */
export function acknowledgeEthicsReport(input: {
  protocol: string;
  access_code: string;
  comment?: string;
}) {
  return request<{ reporterAckAt: string }>("/api/ethics-reports/acknowledge", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type EthicsMessage = {
  id: string;
  side: "REPORTER" | "COMMITTEE";
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
};

export type EthicsReportDetail = {
  id: string;
  protocol: string;
  category: string;
  description: string;
  isAnonymous: boolean;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  /** Ciência de quem denunciou no encerramento. [C1-5] */
  reporterAckAt: string | null;
  reporterAckComment: string | null;
  createdAt: string;
  establishment: { id: string; name: string } | null;
  /** O caso que passou pela triagem, e quando voltou ao comitê. [B3-3-H] */
  committeeInvolved: boolean;
  triagedAt: string | null;
  /** Alta ou Normal; `COMMITTEE` = ajustada pelo comitê. [C1-1] */
  severity: "HIGH" | "NORMAL";
  severitySource: "AUTO" | "COMMITTEE";
  severityChanges: SeverityChange[];
  /** Prazo da primeira providência e a situação dele. [C1-2] */
  dueAt: string;
  firstActionAt: string | null;
  deadline_situation: string;
  messages: EthicsMessage[];
  /** Quem a denúncia envolve — e por isso está fora do caso. [CB-27] */
  cited: Array<{
    userId: string;
    markedAt: string;
    user: { id: string; name: string };
    markedBy: { id: string; name: string } | null;
  }>;
};

/** Um ajuste de gravidade feito pelo comitê. [C1-1] */
export type SeverityChange = {
  id: string;
  fromSeverity: "HIGH" | "NORMAL";
  toSeverity: "HIGH" | "NORMAL";
  reason: string;
  at: string;
  by: { id: string; name: string } | null;
};

/** O comitê ajusta a gravidade, sempre com justificativa. [C1-1] */
export function setEthicsSeverity(id: string, severity: "HIGH" | "NORMAL", reason: string) {
  return request<{ change: SeverityChange }>(
    `/api/ethics-reports/${encodeURIComponent(id)}/gravidade`,
    { method: "POST", body: JSON.stringify({ severity, reason }) },
  );
}

/** Comitê abre o relato (e marca como lidas as mensagens do denunciante). [S5-L] */
export function fetchEthicsReport(id: string) {
  return request<{ report: EthicsReportDetail }>(`/api/ethics-reports/${encodeURIComponent(id)}`);
}

export function sendCommitteeMessage(id: string, body: string) {
  return request<{ message: EthicsMessage }>(`/api/ethics-reports/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function updateEthicsStatus(id: string, input: { status: string; resolution_note?: string }) {
  return request(`/api/ethics-reports/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type CommitteeMember = {
  userId: string;
  addedAt: string;
  user: { id: string; name: string };
  addedBy: { id: string; name: string } | null;
  /** Designação antiga pode ter ficado com quem perdeu o módulo. [CB-62] */
  can_open: boolean;
};

/** Quem é o comitê de ética desta empresa. [CB-27] */
export function fetchEthicsCommittee() {
  return request<{
    members: CommitteeMember[];
    people: Array<{ id: string; name: string; active: boolean }>;
    falling_back: boolean;
  }>("/api/ethics-committee");
}

export function setEthicsCommitteeMember(userId: string, member: boolean) {
  return request<{ ok: true }>("/api/ethics-committee", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, member }),
  });
}

/** Marcar quem a denúncia envolve — e tirar essa pessoa do caso. [CB-27] */
export function setEthicsReportCited(
  reportId: string,
  userId: string,
  cited: boolean,
) {
  return request<{ ok: true }>(
    `/api/ethics-reports/${encodeURIComponent(reportId)}/citados`,
    { method: "POST", body: JSON.stringify({ user_id: userId, cited }) },
  );
}

/** Devolver ao comitê o caso que dizia envolver alguém dele. [B3-3-H] */
export function triarDenuncia(reportId: string) {
  return request<{ ok: true }>(
    `/api/ethics-reports/${encodeURIComponent(reportId)}/triagem`,
    { method: "POST" },
  );
}

/** Nomes da empresa, para o comitê marcar quem a denúncia envolve. [CB-27] */
export function fetchEthicsPeople() {
  return request<{
    people: Array<{ id: string; name: string; active: boolean }>;
  }>("/api/ethics-reports/pessoas").then((d) => d.people);
}

/** Uma linha da lista do comitê. [S5-L] [C1-1] [C1-2] [C1-5] */
export type EthicsListRow = {
  id: string;
  protocol: string;
  category: string;
  /** O começo do relato, para a lista não ser só protocolos. [B2-3-D] */
  description: string;
  status: string;
  isAnonymous: boolean;
  createdAt: string;
  establishment: { name: string } | null;
  _count: { messages: number };
  unread_from_reporter: number;
  /** Zero = o comitê nunca falou nesta denúncia. [B2-3-D] */
  committee_messages: number;
  /**
   * Quem relatou disse que alguém do comitê está envolvido; enquanto
   * `triagedAt` for nulo, o caso só chega a quem tria. [B3-3-H]
   */
  committeeInvolved: boolean;
  triagedAt: string | null;
  severity: "HIGH" | "NORMAL";
  severitySource: "AUTO" | "COMMITTEE";
  dueAt: string;
  firstActionAt: string | null;
  deadline_situation: string;
  reporterAckAt: string | null;
};

/**
 * A lista do comitê, filtrada e paginada no servidor. O filtro vem da query
 * string da página, como está — o mesmo que o PDF usa. [C1-6]
 */
export function fetchEthicsList(query: string) {
  return request<{
    reports: EthicsListRow[];
    total: number;
    page: number;
    page_size: number;
  }>(`/api/ethics-reports${query ? `?${query}` : ""}`);
}

/** Os filtros como o servidor os entendeu. [C1-6] */
export type EthicsFilters = {
  establishmentId?: string;
  statuses?: string[];
  severity?: string;
  category?: string;
  from?: string;
  to?: string;
  situation?: string;
  ack?: "com" | "sem";
  protocol?: string;
};

/** Os dados do PDF da lista. Sem relato e sem mensagens. [C1-6] */
export function fetchEthicsListExport(query: string) {
  return request<{
    organization: { name: string };
    generated_at: string;
    generated_by: { name: string };
    filters: EthicsFilters;
    establishment_name: string | null;
    total: number;
    totals: {
      by_status: Record<string, number>;
      by_severity: Record<string, number>;
      by_situation: Record<string, number>;
    };
    rows: Array<{
      protocol: string;
      createdAt: string;
      establishment: string | null;
      category: string;
      severity: string;
      severitySource: string;
      status: string;
      dueAt: string;
      deadline_situation: string;
      firstActionAt: string | null;
      reporterAckAt: string | null;
    }>;
  }>(`/api/ethics-reports/export${query ? `?${query}` : ""}`);
}

/** Os dados do PDF de uma denúncia. Nenhum identificador de quem relatou. [C1-6] */
export function fetchEthicsReportExport(id: string) {
  return request<{
    organization: { name: string };
    generated_at: string;
    generated_by: { name: string };
    report: {
      protocol: string;
      createdAt: string;
      establishment: string | null;
      category: string;
      severity: string;
      severitySource: string;
      severityChanges: Array<{
        fromSeverity: string;
        toSeverity: string;
        reason: string;
        at: string;
        by: string;
      }>;
      dueAt: string;
      deadline_situation: string;
      firstActionAt: string | null;
      status: string;
      reporter: string;
      description: string;
      messages: Array<{ side: string; author: string; body: string; createdAt: string }>;
      cited: string[];
      resolutionNote: string | null;
      resolvedAt: string | null;
      reporterAckAt: string | null;
      reporterAckComment: string | null;
    };
  }>(`/api/ethics-reports/${encodeURIComponent(id)}/export`);
}
