-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sender_fkey" FOREIGN KEY ("sender") REFERENCES "Session"("sessionName") ON DELETE RESTRICT ON UPDATE CASCADE;
