import { memo } from "react";
import { Formatted } from "@/components/formatted";
import {
  ArrowUpRightIcon,
  FileTextIcon,
  ImageIcon,
  ShieldIcon,
  SparkleIcon,
} from "@/components/icons";

export type ChatRole = "USER" | "ASSISTANT";

export type UiMessage = {
  id: string;
  role: ChatRole;
  content: string;
  images?: string[];
  pending?: boolean;
};

export type PendingImage = {
  id: string;
  name: string;
  mimeType: string;
  data: string;
  preview: string;
};

export type ChatSummary = {
  sessionId: string;
  title: string;
  updatedAt: string;
};

const EXAMPLES = [
  "Amoxicillin 500 mg caps, i po TID x10d",
  "Take 1 tab PO BID x7d PRN fever",
  "Lisinopril 10 mg PO once daily; may cause dry cough",
];

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-primary to-primary-hover font-mono font-semibold tracking-tight text-primary-foreground shadow-card ${className}`}
    >
      Rx
    </span>
  );
}

export function ThinkingDots() {
  return (
    <span className="flex items-center gap-1.5 py-1" role="status" aria-label="Prescribe AI is thinking">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="thinking-dot h-1.5 w-1.5 rounded-full bg-primary"
          style={{ animationDelay: `${index * 140}ms` }}
        />
      ))}
    </span>
  );
}

function MessageRowComponent({ message }: { message: UiMessage }) {
  const isUser = message.role === "USER";
  return (
    <div className={`animate-message-in flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary ring-1 ring-primary/10">
          <SparkleIcon className="h-4 w-4" />
        </span>
      )}
      <div
        className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-card ${
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md border border-border bg-surface"
        }`}
      >
        {isUser ? (
          <div className="space-y-2.5">
            {message.images && message.images.length > 0 && (
              <div
                className={`grid gap-2 ${
                  message.images.length > 1 ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                {message.images.map((src, index) => (
                  <a
                    key={index}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg ring-1 ring-white/20"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`Prescription attachment ${index + 1}`}
                      className="max-h-64 w-full object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
            {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
          </div>
        ) : message.pending && !message.content ? (
          <ThinkingDots />
        ) : (
          <Formatted text={message.content} />
        )}
      </div>
    </div>
  );
}

export const MessageRow = memo(MessageRowComponent);

function EmptyStateComponent({
  onExample,
  ready,
  streaming,
}: {
  onExample: (text: string) => void;
  ready: boolean;
  streaming: boolean;
}) {
  return (
    <div className="animate-fade-in flex flex-col items-center px-2 pb-8 pt-8 text-center sm:pt-12">
      <div className="relative">
        <span className="absolute -inset-5 rounded-full bg-primary/10 blur-2xl" />
        <LogoMark className="relative h-16 w-16 rounded-[20px] text-2xl shadow-float" />
      </div>
      <span className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary-soft px-3 py-1 text-[11px] font-medium text-primary-soft-foreground">
        <ShieldIcon className="h-3 w-3" /> Simple, clear, information only
      </span>
      <h2 className="mt-4 max-w-lg text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
        What does your prescription actually say?
      </h2>
      <p className="mt-3 max-w-md text-balance text-sm leading-relaxed text-muted-foreground">
        Paste a prescription or add a photo. Get the jargon translated into
        plain English.
      </p>
      <div className="mt-8 w-full max-w-xl">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Try an example
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onExample(example)}
              disabled={!ready || streaming}
              className="group flex h-full flex-col items-start gap-2 rounded-xl border border-border bg-surface p-3 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-float disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <FileTextIcon className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs leading-snug text-foreground/80">{example}</span>
              <ArrowUpRightIcon className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <SparkleIcon className="h-3.5 w-3.5 text-primary" /> Plain English
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5 text-primary" /> Photo friendly
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldIcon className="h-3.5 w-3.5 text-primary" /> No medical advice
        </span>
      </div>
    </div>
  );
}

export const EmptyState = memo(EmptyStateComponent);
