CREATE TABLE `maintenance_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`connected_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
