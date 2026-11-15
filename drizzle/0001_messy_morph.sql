DROP INDEX "idx_order_transaction_provider";--> statement-breakpoint
DROP INDEX "idx_subscription_provider_id";--> statement-breakpoint
ALTER TABLE "kdp_project" ADD COLUMN "compiled_snapshot_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_credit_order_grant" ON "credit" USING btree ("order_no") WHERE transaction_type = 'grant' AND order_no IS NOT NULL AND order_no <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_order_transaction_provider" ON "order" USING btree ("transaction_id","payment_provider") WHERE transaction_id IS NOT NULL AND transaction_id <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_subscription_provider_id" ON "subscription" USING btree ("subscription_id","payment_provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_kdp_job_active_project" ON "kdp_job" USING btree ("project_id") WHERE status IN ('queued', 'processing') AND project_id IS NOT NULL;