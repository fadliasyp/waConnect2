/*
  Warnings:

  - Added the required column `sessionId` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_id_fkey";

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "sessionId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
