-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "imageBlur" TEXT;
ALTER TABLE "Brand" ADD COLUMN "imageUrl" TEXT;

-- CreateTable
CREATE TABLE "Showcase" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "imageUrl" TEXT,
    "imageBlur" TEXT,
    "headline" TEXT,
    "subhead" TEXT,
    "updatedAt" DATETIME NOT NULL
);
