import { ReactNode, useEffect, useRef } from "react";
import "./dialog.css";

/**
 * Janela própria para o que não cabe na coluna.
 *
 * Editar a descrição de uma atividade — texto longo — acontecia dentro da
 * coluna estreita da tela de Operação, numa caixa de três linhas. O que é
 * texto longo passa a abrir aqui, com espaço. [B2-1-J]
 *
 * É o `<dialog>` do navegador: a tecla Esc, o foco preso dentro e o fundo
 * escurecido vêm dele, não de código nosso.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-label={title}
      onCancel={(e) => {
        // Esc fecha pela nossa mão, para o estado da tela acompanhar.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clique no fundo escuro fecha; dentro da janela, não.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dlg-head">
        <h2>{title}</h2>
        <button type="button" className="dlg-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>
      </div>
      {description && <p className="dlg-desc">{description}</p>}
      <div className="dlg-body">{children}</div>
    </dialog>
  );
}
