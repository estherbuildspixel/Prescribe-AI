import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { toChatTitle } from "@/lib/titles";

const MAX_CHATS = 50;

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!isValidId(clientId)) {
    return Response.json({ chats: [] });
  }

  const chats = await prisma.chat.findMany({
    where: { clientId, messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take: MAX_CHATS,
    select: {
      sessionId: true,
      updatedAt: true,
      messages: {
        where: { role: Role.USER },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  return Response.json({
    chats: chats.map((chat) => ({
      sessionId: chat.sessionId,
      title: toChatTitle(chat.messages[0]?.content ?? "Untitled chat"),
      updatedAt: chat.updatedAt.toISOString(),
    })),
  });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId");
  const sessionId = params.get("sessionId");
  if (!isValidId(clientId) || !isValidId(sessionId)) {
    return Response.json({ error: "Invalid chat." }, { status: 400 });
  }

  const result = await prisma.chat.deleteMany({ where: { sessionId, clientId } });
  if (result.count === 0) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
