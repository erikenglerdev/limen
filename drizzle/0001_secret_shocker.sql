ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Bestandskonten: auf created_at zurücksetzen, damit vorhandene Sessions nicht
-- sofort invalidiert werden (loginAt liegt nach created_at).
UPDATE "users" SET "password_changed_at" = "created_at";