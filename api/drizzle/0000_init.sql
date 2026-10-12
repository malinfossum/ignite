CREATE SEQUENCE "public"."server_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "areas" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"critical" boolean NOT NULL,
	"order" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"server_seq" bigint DEFAULT nextval('server_seq_seq') NOT NULL,
	CONSTRAINT "areas_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"area_id" text NOT NULL,
	"name" text NOT NULL,
	"collapsed" boolean NOT NULL,
	"order" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"server_seq" bigint DEFAULT nextval('server_seq_seq') NOT NULL,
	CONSTRAINT "sections_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"quiet_start" integer NOT NULL,
	"quiet_end" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"server_seq" bigint DEFAULT nextval('server_seq_seq') NOT NULL,
	CONSTRAINT "settings_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"section_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text NOT NULL,
	"completed" boolean NOT NULL,
	"starred" boolean NOT NULL,
	"critical" boolean NOT NULL,
	"due_at" timestamp with time zone,
	"has_time" boolean NOT NULL,
	"recurrence" jsonb,
	"last_completed_at" timestamp with time zone,
	"completed_count" integer NOT NULL,
	"lead_time" integer NOT NULL,
	"scheduled_tags" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"order" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"server_seq" bigint DEFAULT nextval('server_seq_seq') NOT NULL,
	CONSTRAINT "tasks_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tombstones" (
	"user_id" text NOT NULL,
	"store" text NOT NULL,
	"id" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"server_seq" bigint DEFAULT nextval('server_seq_seq') NOT NULL,
	CONSTRAINT "tombstones_user_id_store_id_pk" PRIMARY KEY("user_id","store","id")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tombstones" ADD CONSTRAINT "tombstones_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_user_seq_idx" ON "areas" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "sections_user_seq_idx" ON "sections" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "settings_user_seq_idx" ON "settings" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "tasks_user_seq_idx" ON "tasks" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "tombstones_user_seq_idx" ON "tombstones" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");