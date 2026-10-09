import "./ethics-thread.css";

type Message = {
  id: string;
  side: string;
  body: string;
  createdAt: string;
  author?: { name: string } | null;
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Conversa entre o comitê e quem denunciou. O lado de quem está lendo fica à
 * direita. O denunciante nunca vê o nome de quem do comitê respondeu, e o
 * comitê nunca vê quem denunciou quando é anônimo.
 */
export function EthicsThread({
  messages,
  viewer,
}: {
  messages: Message[];
  viewer: "COMMITTEE" | "REPORTER";
}) {
  if (messages.length === 0) {
    return <p className="muted">Nenhuma mensagem ainda.</p>;
  }
  return (
    <ol className="ethics-thread">
      {messages.map((m) => {
        const mine = m.side === viewer;
        const who =
          m.side === "COMMITTEE"
            ? viewer === "COMMITTEE"
              ? `Comitê${m.author?.name ? ` · ${m.author.name}` : ""}`
              : "Comitê de ética"
            : viewer === "REPORTER"
              ? "Você"
              : "Quem denunciou";
        return (
          <li key={m.id} className={`ethics-msg${mine ? " is-mine" : ""}`}>
            <div className="ethics-msg-head">
              <strong>{who}</strong>
              <span>{formatDateTime(m.createdAt)}</span>
            </div>
            <p>{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
