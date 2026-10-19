// The public origin the instance is served from (e.g. https://chessstack.app),
// used to build absolute links in emails and Stripe redirects. adapter-node
// reads the same ORIGIN variable for request URLs.
export const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000';
