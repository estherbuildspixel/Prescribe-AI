-- Backfill legacy chats so existing browser sessions keep their history
UPDATE "Chat" SET "clientId" = "sessionId" WHERE "clientId" IS NULL;
