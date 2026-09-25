import type { ReactNode } from "react";
import "./chip.css";

type Tone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "ouro"
  | "risk-trivial"
  | "risk-tolerable"
  | "risk-moderate"
  | "risk-substantial"
  | "risk-intolerable";

type Props = {
  children: ReactNode;
  tone?: Tone;
  className?: string;
};

export function Chip({ children, tone = "neutral", className = "" }: Props) {
  return (
    <span className={`chip chip-${tone}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
