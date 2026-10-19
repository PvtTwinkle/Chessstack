// Account deletion cancels the Stripe subscription first, and keeps the
// account when Stripe can't confirm the subscription has ended.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { auditLog, user } from '$lib/db/schema';
import { resetDb, createUser, createSubscription } from '$lib/test/db-helpers';

const stripeApi = vi.hoisted(() => ({
	subscriptions: { cancel: vi.fn(), retrieve: vi.fn() }
}));

vi.mock('$lib/stripe/client', () => ({ getStripe: () => stripeApi }));

const { DELETE: deleteOwnAccount } = await import('../../routes/api/auth/delete-account/+server');
const { DELETE: adminDeleteUser } = await import('../../routes/api/admin/users/[id]/+server');

const PASSWORD = 'correct horse battery staple';
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

function stripeError(code: string) {
	return Object.assign(new Error(code), { code });
}

async function userExists(id: number) {
	return (await db.select({ id: user.id }).from(user).where(eq(user.id, id))).length === 1;
}

async function deleteOwn(userId: number) {
	const request = new Request('http://localhost/api/auth/delete-account', {
		method: 'DELETE',
		body: JSON.stringify({ password: PASSWORD })
	});
	const locals = { user: { id: userId, username: 'u', role: 'user', tier: 'paid' } };
	const cookies = { delete: vi.fn() };
	return deleteOwnAccount({ locals, request, cookies } as never);
}

async function adminDelete(adminId: number, targetId: number) {
	const locals = { user: { id: adminId, username: 'admin', role: 'admin', tier: 'paid' } };
	return adminDeleteUser({ locals, params: { id: String(targetId) } } as never);
}

async function payingUser() {
	const id = await createUser({ passwordHash });
	await createSubscription(id, { tier: 'paid', stripeSubscriptionId: 'sub_1' });
	return id;
}

beforeEach(async () => {
	await resetDb();
	// resetDb leaves the audit log alone, and user ids restart from 1.
	await db.delete(auditLog);
	vi.clearAllMocks();
});

describe('DELETE /api/auth/delete-account', () => {
	it('cancels the subscription, then deletes the account', async () => {
		const u = await payingUser();
		stripeApi.subscriptions.cancel.mockResolvedValue({ status: 'canceled' });

		const res = await deleteOwn(u);
		expect(res.status).toBe(200);
		expect(stripeApi.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
		expect(await userExists(u)).toBe(false);
	});

	it('keeps the account when Stripe cancel fails', async () => {
		const u = await payingUser();
		stripeApi.subscriptions.cancel.mockRejectedValue(stripeError('api_connection_error'));
		stripeApi.subscriptions.retrieve.mockRejectedValue(stripeError('api_connection_error'));

		await expect(deleteOwn(u)).rejects.toMatchObject({ status: 502 });
		expect(await userExists(u)).toBe(true);
	});

	it('keeps the account when the subscription is still active', async () => {
		const u = await payingUser();
		stripeApi.subscriptions.cancel.mockRejectedValue(stripeError('rate_limit'));
		stripeApi.subscriptions.retrieve.mockResolvedValue({ status: 'active' });

		await expect(deleteOwn(u)).rejects.toMatchObject({ status: 502 });
		expect(await userExists(u)).toBe(true);
	});

	it('deletes the account when the subscription no longer exists in Stripe', async () => {
		const u = await payingUser();
		stripeApi.subscriptions.cancel.mockRejectedValue(stripeError('resource_missing'));

		await deleteOwn(u);
		expect(await userExists(u)).toBe(false);
	});

	it('deletes the account when the subscription was already canceled', async () => {
		const u = await payingUser();
		stripeApi.subscriptions.cancel.mockRejectedValue(stripeError('subscription_canceled'));
		stripeApi.subscriptions.retrieve.mockResolvedValue({ status: 'canceled' });

		await deleteOwn(u);
		expect(await userExists(u)).toBe(false);
	});

	it('does not call Stripe for a user without a subscription', async () => {
		const u = await createUser({ passwordHash });
		await deleteOwn(u);
		expect(stripeApi.subscriptions.cancel).not.toHaveBeenCalled();
		expect(await userExists(u)).toBe(false);
	});
});

describe('DELETE /api/admin/users/[id]', () => {
	it('keeps the user, and writes no audit entry, when Stripe cancel fails', async () => {
		const admin = await createUser({ role: 'admin' });
		const u = await payingUser();
		stripeApi.subscriptions.cancel.mockRejectedValue(stripeError('api_connection_error'));
		stripeApi.subscriptions.retrieve.mockRejectedValue(stripeError('api_connection_error'));

		await expect(adminDelete(admin, u)).rejects.toMatchObject({ status: 502 });
		expect(await userExists(u)).toBe(true);
		expect(await db.select().from(auditLog)).toHaveLength(0);
	});

	it('cancels the subscription, then deletes the user', async () => {
		const admin = await createUser({ role: 'admin' });
		const u = await payingUser();
		stripeApi.subscriptions.cancel.mockResolvedValue({ status: 'canceled' });

		const res = await adminDelete(admin, u);
		expect(res.status).toBe(200);
		expect(await userExists(u)).toBe(false);
	});
});
