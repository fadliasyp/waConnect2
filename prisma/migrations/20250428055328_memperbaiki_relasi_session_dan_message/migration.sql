/*
  Warnings:

  - A unique constraint covering the columns `[sender]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Message_sender_key" ON "Message"("sender");
