/*
  Warnings:

  - You are about to drop the column `btcAmount` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `btcRateCents` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `btcTxid` on the `Order` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "CryptoWallet" (
    "assetKey" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "shippingMethod" TEXT NOT NULL DEFAULT 'boxed',
    "paymentMethod" TEXT NOT NULL DEFAULT 'crypto',
    "cryptoAsset" TEXT,
    "cryptoAmount" TEXT,
    "cryptoRateCents" INTEGER,
    "cryptoTxid" TEXT,
    "name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 老数据来自只支持 BTC 的版本：paymentMethod='btc' 的订单迁成 'crypto' + cryptoAsset='btc'，
-- 金额、汇率、TXID 原样搬过去。历史订单的付款凭证不能丢，丢了就对不了账。
INSERT INTO "new_Order" ("id", "number", "email", "status", "subtotalCents", "discountCents", "shippingCents", "taxCents", "totalCents", "shippingMethod", "paymentMethod", "cryptoAsset", "cryptoAmount", "cryptoRateCents", "cryptoTxid", "name", "line1", "line2", "city", "state", "postalCode", "country", "phone", "createdAt")
SELECT "id", "number", "email", "status", "subtotalCents", "discountCents", "shippingCents", "taxCents", "totalCents", "shippingMethod",
       CASE WHEN "paymentMethod" = 'btc' THEN 'crypto' ELSE "paymentMethod" END,
       CASE WHEN "paymentMethod" = 'btc' THEN 'btc' END,
       "btcAmount", "btcRateCents", "btcTxid",
       "name", "line1", "line2", "city", "state", "postalCode", "country", "phone", "createdAt"
FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "Order_status_idx" ON "Order"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
