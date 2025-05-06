/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `Session` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Session_userId_key" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
