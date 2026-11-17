-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "Chat_clientId_updatedAt_idx" ON "Chat"("clientId", "updatedAt");
