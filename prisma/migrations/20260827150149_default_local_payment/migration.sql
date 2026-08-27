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
    "paymentMethod" TEXT NOT NULL DEFAULT 'whatsapp',
    "cryptoAsset" TEXT,
    "cryptoAmount" TEXT,
    "cryptoRateCents" INTEGER,
    "cryptoTxid" TEXT,
    "cryptoVerifiedAt" DATETIME,
    "trackingNumber" TEXT,
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
INSERT INTO "new_Order" ("city", "country", "createdAt", "cryptoAmount", "cryptoAsset", "cryptoRateCents", "cryptoTxid", "cryptoVerifiedAt", "discountCents", "email", "id", "line1", "line2", "name", "number", "paymentMethod", "phone", "postalCode", "shippingCents", "shippingMethod", "state", "status", "subtotalCents", "taxCents", "totalCents", "trackingNumber") SELECT "city", "country", "createdAt", "cryptoAmount", "cryptoAsset", "cryptoRateCents", "cryptoTxid", "cryptoVerifiedAt", "discountCents", "email", "id", "line1", "line2", "name", "number", "paymentMethod", "phone", "postalCode", "shippingCents", "shippingMethod", "state", "status", "subtotalCents", "taxCents", "totalCents", "trackingNumber" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
CREATE UNIQUE INDEX "Order_cryptoTxid_key" ON "Order"("cryptoTxid");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "Order_status_idx" ON "Order"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
