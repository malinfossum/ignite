// The Worker's bindings. ALLOWED_EMAILS and BETTER_AUTH_SECRET are secrets;
// ALLOWED_EMAILS is comma-separated and compared trimmed and lowercased.
export interface Env {
	HYPERDRIVE: Hyperdrive;
	ASSETS: Fetcher;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	ALLOWED_EMAILS: string;
}
