/*
  Warnings:

  - A unique constraint covering the columns `[whatsappPhoneNumberId]` on the table `Business` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "whatsappPhoneNumberId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Business_whatsappPhoneNumberId_key" ON "Business"("whatsappPhoneNumberId");
