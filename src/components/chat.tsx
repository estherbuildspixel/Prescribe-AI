"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  EmptyState,
  LogoMark,
  MessageRow,
  ThinkingDots,
  type ChatSummary,
  type PendingImage,
  type UiMessage,
} from "@/components/chat-parts";
import {
  AlertIcon,
  CloseIcon,
  FileTextIcon,
  ImageIcon,
  MenuIcon,
  MessageIcon,
  PlusIcon,
  SendIcon,
  ShieldIcon,
  SparkleIcon,
  TrashIcon,
} from "@/components/icons";
import {
  IMAGE_ACCEPT,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGES,
  isAllowedImageMimeType,
} from "@/lib/images";
import { formatRelativeTime } from "@/lib/time";

const CLIENT_KEY = "prescribe-ai-client";
const SESSION_KEY = "prescribe-ai-session";

function resolveImageMimeType(file: File) {
  if (isAllowedImageMimeType(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  return null;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.readAsDataURL(blob);
  });
}

function base64FromDataUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

async function prepareImage(file: File): Promise<PendingImage> {
  const mimeType = resolveImageMimeType(file);
  if (!mimeType) {
    throw new Error(`"${file.name}" is not a supported image.`);
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(`"${file.name}" is too large. Please use an image under 10 MB.`);
  }

  const preview = await readAsDataUrl(file);
  const fallback: PendingImage = {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType,
    data: base64FromDataUrl(preview),
    preview,
  };

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return fallback;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) return fallback;
    const compressed = await readAsDataUrl(blob);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: "image/jpeg",
      data: base64FromDataUrl(compressed),
      preview: compressed,
    };
  } catch {
    return fallback;
  }
}

export function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const clientRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadChats() {
    const clientId = clientRef.current;
    if (!clientId) return;
    try {
      const res = await fetch(`/api/chats?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { chats?: ChatSummary[] };
      setChats(data.chats ?? []);
    } catch {
      // Keep the existing list if the request fails.
    }
  }

  async function loadMessages(id: string) {
    const requestId = ++loadRequestRef.current;
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/chat?sessionId=${encodeURIComponent(id)}`);
      const data = res.ok ? ((await res.json()) as { messages?: UiMessage[] }) : null;
      if (requestId !== loadRequestRef.current) return;
      setMessages(data?.messages ?? []);
    } catch {
      if (requestId !== loadRequestRef.current) return;
      setMessages([]);
    } finally {
      if (requestId === loadRequestRef.current) setLoadingMessages(false);
    }
  }

  async function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (incoming.length === 0 || streaming) return;
    setError(null);
    setUploading(true);
    try {
      const prepared: PendingImage[] = [];
      let hitLimit = false;
      for (const file of incoming) {
        if (images.length + prepared.length >= MAX_IMAGES) {
          hitLimit = true;
          break;
        }
        try {
          prepared.push(await prepareImage(file));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not add that image.");
        }
      }
      if (prepared.length > 0) {
        setImages((prev) => [...prev, ...prepared].slice(0, MAX_IMAGES));
      }
      if (hitLimit) {
        setError(`You can attach up to ${MAX_IMAGES} images per message.`);
      }
    } finally {
      setUploading(false);
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((image) => image.id !== id));
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      setDragActive(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files);
    }
  }

  useEffect(() => {
    let storedSession = localStorage.getItem(SESSION_KEY);
    let storedClient = localStorage.getItem(CLIENT_KEY);
    if (!storedClient) {
      storedClient = storedSession ?? crypto.randomUUID();
      localStorage.setItem(CLIENT_KEY, storedClient);
    }
    if (!storedSession) {
      storedSession = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, storedSession);
    }
    clientRef.current = storedClient;
    sessionRef.current = storedSession;

    const init = async () => {
      setSessionId(storedSession);
      await Promise.all([loadChats(), loadMessages(storedSession)]);
      setReady(true);
    };
    void init();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateKeyboardInset = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height));
      document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    updateKeyboardInset();
    viewport.addEventListener("resize", updateKeyboardInset);
    viewport.addEventListener("scroll", updateKeyboardInset);
    window.addEventListener("resize", updateKeyboardInset);
    return () => {
      viewport.removeEventListener("resize", updateKeyboardInset);
      viewport.removeEventListener("scroll", updateKeyboardInset);
      window.removeEventListener("resize", updateKeyboardInset);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function openChat(id: string) {
    if (streaming) return;
    setSidebarOpen(false);
    if (id === sessionId) return;
    localStorage.setItem(SESSION_KEY, id);
    sessionRef.current = id;
    setSessionId(id);
    setInput("");
    setImages([]);
    setError(null);
    stickToBottomRef.current = true;
    void loadMessages(id);
  }

  function startNewChat() {
    if (streaming) return;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    sessionRef.current = id;
    setSessionId(id);
    setMessages([]);
    setInput("");
    setImages([]);
    setError(null);
    setSidebarOpen(false);
    loadRequestRef.current += 1;
    setLoadingMessages(false);
    textareaRef.current?.focus();
  }

  async function deleteChat(id: string) {
    const clientId = clientRef.current;
    if (streaming || !clientId) return;
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    try {
      const res = await fetch(
        `/api/chats?clientId=${encodeURIComponent(clientId)}&sessionId=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Delete failed");
      setChats((prev) => prev.filter((chat) => chat.sessionId !== id));
      if (id === sessionRef.current) {
        startNewChat();
      }
    } catch {
      setError("Could not delete this chat. Please try again.");
    }
  }

  async function send(text: string, attachments: PendingImage[] = []) {
    const trimmed = text.trim();
    const activeSession = sessionRef.current;
    const clientId = clientRef.current;
    if ((!trimmed && attachments.length === 0) || !activeSession || !clientId || streaming) {
      return;
    }
    setError(null);
    setInput("");
    setImages([]);
    setStreaming(true);
    stickToBottomRef.current = true;

    const payload = attachments.map(({ mimeType, data }) => ({ mimeType, data }));
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: "USER",
        content: trimmed,
        images: attachments.map((image) => image.preview),
      },
      { id: assistantId, role: "ASSISTANT", content: "", pending: true },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSession,
          clientId,
          message: trimmed,
          images: payload,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          data?.error ?? `Request failed (${res.status}). Please try again.`
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: accumulated, pending: false }
              : m
          )
        );
      }
      void loadChats();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
      setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          className="animate-fade-in fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px] md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close chat history"
        />
      )}

      <aside
        className={`safe-top safe-bottom safe-x fixed inset-y-0 left-0 z-40 flex w-[min(90vw,320px)] shrink-0 flex-col border-r border-border bg-surface transition-transform duration-300 ease-out md:static md:z-auto md:w-[272px] md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Chat history"
      >
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <LogoMark className="h-9 w-9 rounded-[11px] text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">Prescribe AI</p>
            <p className="truncate text-[11px] text-muted-foreground">
              Plain English, always
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            aria-label="Close chat history"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-4">
          <button
            type="button"
            onClick={startNewChat}
            disabled={streaming}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground shadow-card transition-all hover:bg-primary-hover hover:shadow-float disabled:opacity-50 disabled:shadow-none"
          >
            <PlusIcon className="h-4 w-4" /> New conversation
          </button>
        </div>

        <div className="flex items-center justify-between px-5 pb-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Recent
          </span>
          {chats.length > 0 && (
            <span className="text-[11px] text-muted-foreground">{chats.length}</span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? (
            <div className="mx-2 mt-1 rounded-xl border border-dashed border-border px-4 py-6 text-center">
              <MessageIcon className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Your conversations will show up here.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {chats.map((chat) => {
                const active = chat.sessionId === sessionId;
                return (
                  <li key={chat.sessionId} className="group relative">
                    <button
                      type="button"
                      onClick={() => openChat(chat.sessionId)}
                      disabled={streaming}
                      aria-current={active ? "page" : undefined}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 pr-12 text-left transition-colors disabled:opacity-50 ${
                        active
                          ? "bg-primary-soft text-primary-soft-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          active
                            ? "bg-surface text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <FileTextIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13px] ${
                            active ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {chat.title}
                        </span>
                        <span
                          className={`mt-0.5 block text-[11px] ${
                            active
                              ? "text-primary-soft-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatRelativeTime(chat.updatedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteChat(chat.sessionId)}
                      disabled={streaming}
                      aria-label={`Delete ${chat.title}`}
                      className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground opacity-100 transition-all hover:bg-surface hover:text-red-600 disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 dark:hover:text-red-400"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex gap-2 rounded-xl bg-muted/70 p-3">
            <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Information only. Confirm with your doctor.
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="safe-top safe-x shrink-0 border-b border-border bg-surface/90 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              aria-label="Open chat history"
            >
              <MenuIcon className="h-4 w-4" />
            </button>
            <LogoMark className="h-9 w-9 rounded-[11px] text-sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-semibold tracking-tight">
                  Prescribe AI
                </h1>
                <span className="hidden items-center gap-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-soft-foreground sm:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> AI powered
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                Your prescription, in plain English
              </p>
            </div>
            <button
              type="button"
              onClick={startNewChat}
              disabled={streaming}
              aria-label="Start a new chat"
              title="New chat"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary-soft-foreground disabled:opacity-40"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="app-canvas min-h-0 flex-1 overflow-y-auto"
          role="log"
          aria-live="polite"
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-7 sm:px-6">
            {loadingMessages ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <SparkleIcon className="h-5 w-5 animate-pulse" />
                </span>
                <p className="mt-3 text-sm text-muted-foreground">
                  Loading your conversation…
                </p>
              </div>
            ) : messages.length === 0 ? (
              <EmptyState onExample={send} ready={ready} streaming={streaming} />
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <MessageRow key={message.id} message={message} />
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="safe-bottom safe-x shrink-0 border-t border-border bg-surface/95 backdrop-blur-md">
          <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-3 sm:px-6">
            {error && (
              <div
                className="animate-fade-in mb-3 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-xs text-red-700 dark:text-red-300"
                role="alert"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1 leading-relaxed">{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                  aria-label="Dismiss error"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {images.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {images.map((image) => (
                  <div key={image.id} className="group relative h-16 w-16">
                    <div className="h-full w-full overflow-hidden rounded-xl border border-border bg-muted shadow-card">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.preview}
                        alt={image.name || "Prescription attachment"}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      disabled={streaming}
                      aria-label={`Remove ${image.name || "image"}`}
                      className="group/remove absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-background transition-colors disabled:opacity-40"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/85 shadow-sm transition-colors group-hover/remove:bg-red-600 group-hover/remove:text-white">
                        <CloseIcon className="h-3 w-3" />
                      </span>
                    </button>
                  </div>
                ))}
                {uploading && (
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-primary/40 bg-primary-soft/40">
                    <ThinkingDots />
                  </div>
                )}
              </div>
            )}

            <form
              className={`rounded-2xl border bg-surface p-2 shadow-card transition-all focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 ${
                dragActive
                  ? "border-primary bg-primary-soft/40 ring-4 ring-primary/10"
                  : "border-border"
              }`}
              onSubmit={(event) => {
                event.preventDefault();
                send(input, images);
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length > 0) {
                  event.preventDefault();
                  void addFiles(files);
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              {dragActive && (
                <p className="px-2 pb-1 text-xs font-medium text-primary">
                  Drop your images to attach
                </p>
              )}
              <div className="flex items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming || uploading || images.length >= MAX_IMAGES}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-30"
                  aria-label="Attach prescription photo"
                  title="Attach a photo of your prescription"
                >
                  <ImageIcon className="h-[18px] w-[18px]" />
                </button>
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send(input, images);
                    }
                  }}
                  placeholder="Paste your prescription or attach a photo…"
                  className="composer-input max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/80 focus-visible:outline-none"
                />
                <button
                  type="submit"
                  disabled={
                    streaming ||
                    !ready ||
                    uploading ||
                    (input.trim().length === 0 && images.length === 0)
                  }
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-card transition-all hover:bg-primary-hover hover:shadow-float disabled:opacity-40 disabled:shadow-none"
                  aria-label="Send message"
                  title="Send message"
                >
                  <SendIcon className="h-4 w-4" />
                </button>
              </div>
            </form>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
              <span>Up to {MAX_IMAGES} photos · drag & drop or paste</span>
              <span className="inline-flex items-center gap-1">
                <ShieldIcon className="h-3 w-3" /> General information only
              </span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
