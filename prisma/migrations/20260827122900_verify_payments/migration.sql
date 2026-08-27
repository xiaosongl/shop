-- 链上核实通过的时间。人工确认收款的订单留空，据此能分清哪些是自动放行的。
ALTER TABLE "Order" ADD COLUMN "cryptoVerifiedAt" DATETIME;

-- 同一笔转账不能认领两笔订单。SQLite 的唯一索引允许多个 NULL，
-- 所以没填 TXID 的订单不受影响。
-- 用索引而不是重建表：加约束的效果一样，但不动数据。
CREATE UNIQUE INDEX "Order_cryptoTxid_key" ON "Order"("cryptoTxid");
