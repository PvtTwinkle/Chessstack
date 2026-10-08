// Type declarations for SvelteKit's built-in interfaces.
//
// These are not imported anywhere — SvelteKit reads this file automatically
// and uses the types globally across the entire app.

declare global {
	namespace App {
		// `locals` is an object that lives for the duration of a single HTTP request.
		// The middleware (hooks.server.ts) sets `locals.user` after checking the session
		// cookie. Every +page.server.ts and +server.ts can then read `locals.user`
		// without touching the database again.
		//
		// null means the request is unauthenticated.
		interface Locals {
			user: {
				id: number;
				username: string;
				role: string;
				tier: 'free' | 'paid';
				email: string | null;
				emailVerified: boolean;
			} | null;

			// Random id for this request, set first thing in hooks.server.ts. It is
			// attached to every log line and Sentry event for the request and sent
			// back in the X-Request-Id header.
			requestId: string;
		}

		// The shape of `page.error`. requestId is set for unexpected (500) errors
		// so the error page can show it and a bug report can be matched to logs.
		interface Error {
			message: string;
			requestId?: string;
		}
	}
}

export {};
