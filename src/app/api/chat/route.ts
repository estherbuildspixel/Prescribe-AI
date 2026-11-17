import { Prisma, Role } from "@/generated/prisma/client";
import {
  SYSTEM_INSTRUCTION,
  generateContentStreamWithRetry,
  getGemini,
  toContents,
} from "@/lib/gemini";
import {
  MAX_IMAGE_BASE64_LENGTH,
  MAX_IMAGE_TOTAL_BASE64_LENGTH,
  MAX_IMAGES,
  parseChatImages,
  parseStoredImages,
  toDataUrl,
} from "@/lib/images";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";

const HISTORY_LIMIT = 8;
const MAX_MESSAGE_LENGTH = 6000;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const rateLimiter = createRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);
const DEFAULT_IMAGE_PROMPT =
  "Please read this prescription image and explain it in plain English.";
const IMAGE_CONTEXT_PLACEHOLDER = "[User uploaded a prescription or medicine photo]";

const chatSelect = {
  id: true,
  clientId: true,
  messages: {
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  },
} satisfies Prisma.ChatSelect;

async function getOrCreateChat(sessionId: string, clientId: string) {
  const existing = await prisma.chat.findUnique({
    where: { sessionId },
    select: chatSelect,
  });
  if (existing) {
    if (!existing.clientId) {
      try {
        await prisma.chat.update({ where: { id: existing.id }, data: { clientId } });
      } catch (err) {
        console.error("Failed to claim chat for client:", err);
      }
    }
    return existing;
  }
  try {
    return await prisma.chat.create({
      data: { sessionId, clientId },
      select: chatSelect,
    });
  } catch {
    return await prisma.chat.findUnique({
      where: { sessionId },
      select: chatSelect,
    });
  }
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId || sessionId.length > 64) {
    return Response.json({ messages: [] });
  }
  const chat = await prisma.chat.findUnique({
    where: { sessionId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return Response.json({
    messages: (chat?.messages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      images: parseStoredImages(message.attachments).map(toDataUrl),
    })),
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const {
    sessionId,
    clientId: rawClientId,
    message,
    images: rawImages,
  } = (body ?? {}) as {
    sessionId?: unknown;
    clientId?: unknown;
    message?: unknown;
    images?: unknown;
  };

  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 64) {
    return Response.json({ error: "Invalid session." }, { status: 400 });
  }
  const clientId =
    typeof rawClientId === "string" && rawClientId.length > 0 && rawClientId.length <= 64
      ? rawClientId
      : sessionId;

  if (!rateLimiter(clientId)) {
    return Response.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  const images = parseChatImages(rawImages, {
    maxImages: MAX_IMAGES,
    maxBytes: MAX_IMAGE_BASE64_LENGTH,
    maxTotalBytes: MAX_IMAGE_TOTAL_BASE64_LENGTH,
  });
  const text = typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  if (!text && images.length === 0) {
    return Response.json(
      { error: "Please type a prescription or add a photo first." },
      { status: 400 }
    );
  }

  let gemini;
  try {
    gemini = getGemini();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const chat = await getOrCreateChat(sessionId, clientId);
  if (!chat) {
    return Response.json({ error: "Could not start a chat. Please try again." }, { status: 500 });
  }

  const promptText = text || DEFAULT_IMAGE_PROMPT;
  const history = [
    ...chat.messages.map((m) => ({
      role: m.role as string,
      content: m.content || IMAGE_CONTEXT_PLACEHOLDER,
    })),
    { role: "USER", content: promptText, images },
  ];
  const recent = history.slice(-HISTORY_LIMIT);

  const userMessagePromise = prisma.message
    .create({
      data: {
        chatId: chat.id,
        role: Role.USER,
        content: text,
        attachments:
          images.length > 0 ? (images as unknown as Prisma.InputJsonValue) : undefined,
      },
    })
    .catch((err) => {
      console.error("Failed to save user message:", err);
      return null;
    });

  let geminiStream;
  try {
    geminiStream = await generateContentStreamWithRetry(gemini, {
      contents: toContents(recent),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.3,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: request.signal,
      },
    });
  } catch (err) {
    console.error("Gemini stream failed to start:", err);
    const userMessage = await userMessagePromise;
    if (userMessage) {
      try {
        await prisma.message.delete({ where: { id: userMessage.id } });
      } catch (cleanupErr) {
        console.error("Failed to roll back unsent message:", cleanupErr);
      }
    }
    return Response.json(
      { error: "The AI model is busy right now. Please try again in a moment." },
      { status: 503 }
    );
  }
  console.info(`Gemini stream ready in ${Date.now() - startedAt}ms`);
  await userMessagePromise;

  let full = "";
  const encoder = new TextEncoder();
  const chatId = chat.id;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of geminiStream) {
          const piece = chunk.text ?? "";
          if (piece) {
            full += piece;
            controller.enqueue(encoder.encode(piece));
          }
        }
      } catch (err) {
        console.error("Streaming failed:", err);
        if (!full) {
          full = "Sorry, something went wrong while generating the explanation. Please try again.";
          controller.enqueue(encoder.encode(full));
        }
      } finally {
        try {
          if (full.trim()) {
            await prisma.message.create({
              data: { chatId, role: Role.ASSISTANT, content: full },
            });
          }
        } catch (err) {
          console.error("Failed to save assistant message:", err);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
