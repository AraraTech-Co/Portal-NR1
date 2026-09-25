import "./loading-state.css";

type Props = {
  label?: string;
  /** Full-viewport centered layout (auth boot). */
  fullscreen?: boolean;
};

export function LoadingState({
  label = "Carregando…",
  fullscreen = false,
}: Props) {
  return (
    <div
      className={fullscreen ? "loading-state loading-state--fullscreen" : "loading-state"}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="loading-state-spinner" aria-hidden />
      <p className="loading-state-label muted">{label}</p>
    </div>
  );
}
