import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./button.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  /**
   * "compact" é o botão de linha de lista — ação repetida ao lado de cada
   * item. Era CSS solto em cada tela, com medidas diferentes; agora é o
   * padrão, com nome. [B2-1-J]
   */
  size?: "default" | "compact";
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "default",
  className = "",
  type = "button",
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${size === "compact" ? " btn-compact" : ""}${
        className ? ` ${className}` : ""
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}
