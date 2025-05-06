/*
  Warnings:

  - You are about to drop the column `sessionId` on the `Session` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[sessionName]` on the table `Session` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sessionName` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Session_sessionId_key";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "sessionId",
ADD COLUMN     "sessionName" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionName_key" ON "Session"("sessionName");
