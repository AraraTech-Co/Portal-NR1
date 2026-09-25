import ReactMarkdown from "react-markdown";
import "./markdown-body.css";

type Props = {
  children: string;
  className?: string;
};

/** Renderiza Markdown (inclui texto colado do ChatGPT). */
export function MarkdownBody({ children, className = "" }: Props) {
  return (
    <div className={`markdown-body${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
