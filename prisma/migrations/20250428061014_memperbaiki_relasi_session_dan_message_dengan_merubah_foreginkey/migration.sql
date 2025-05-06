/*
  Warnings:

  - The primary key for the `Message` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_sender_fkey";

-- AlterTable
ALTER TABLE "Message" DROP CONSTRAINT "Message_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Message_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Message_id_seq";

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_id_fkey" FOREIGN KEY ("id") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
