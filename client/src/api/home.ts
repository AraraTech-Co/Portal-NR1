import { request } from "./client";

export type HomeCard = {
  id: string;
  label: string;
  count: number;
  link: string;
  tone?: "info" | "warning";
  detail?: string | null;
};

export type HomeStep = {
  id: string;
  label: string;
  done: boolean;
  link: string;
};

export type HomeOverview = {
  generated_at: string;
  /** O que é da pessoa que abriu. */
  mine: HomeCard[];
  /** O que está na mesa de quem cuida do módulo. [S5-A] */
  desk: HomeCard[];
  /** A empresa está em dia? `null` para quem não lê o PGR. [S6-A] */
  compliance: HomeCard[] | null;
  /** O que vence na janela de aviso. [S6-B] */
  expiring: HomeCard[];
  /** Primeiros passos, enquanto a casa não está montada. [S1-F] */
  first_steps: HomeStep[] | null;
  window_days: number;
  /** O que foi conferido para "o que vence" — vazio quando nada se aplica a quem abre. [S6-B] */
  expiring_checked: string[];
};

export function fetchHome() {
  return request<HomeOverview>("/api/inicio");
}
