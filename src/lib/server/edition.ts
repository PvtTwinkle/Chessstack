// Which edition this instance runs as: chessstack.app ('cloud') or a
// self-hosted install ('selfhosted'). The open-source repository is exported
// from this one, so both editions share this code and EDITION picks the
// behaviour that differs:
//
//   cloud        plan limits, visitors see the marketing site, sign-up asks for
//                an email and a referral code, the first person to register
//                becomes admin.
//   selfhosted   no plan limits, visitors are sent to /login, the marketing
//                pages are not served, email is optional, and a default admin
//                is created from DEFAULT_USERNAME / DEFAULT_PASSWORD.
//
// Anything other than 'cloud' means self-hosted, so a self-hoster can never
// end up with plan limits by leaving the variable out.

export type Edition = 'cloud' | 'selfhosted';

export function parseEdition(value: string | undefined): Edition {
	return value?.trim().toLowerCase() === 'cloud' ? 'cloud' : 'selfhosted';
}

export const EDITION: Edition = parseEdition(process.env.EDITION);
export const IS_CLOUD = EDITION === 'cloud';

// Public pages that exist only on chessstack.app. On a self-hosted instance
// they answer 404, and the open-source export leaves their files out.
export const CLOUD_ONLY_ROUTES = [
	'/landing',
	'/blog',
	'/openings',
	'/sitemap.xml',
	'/llms.txt',
	'/terms',
	'/privacy'
];

export function isCloudOnlyRoute(pathname: string): boolean {
	return CLOUD_ONLY_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'));
}
