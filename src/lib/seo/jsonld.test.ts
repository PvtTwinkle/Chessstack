import { describe, expect, it } from 'vitest';
import {
	ORGANIZATION_ID,
	articleSchema,
	breadcrumbSchema,
	faqSchema,
	organizationSchema,
	serializeJsonLd,
	webApplicationSchema
} from './jsonld';

describe('serializeJsonLd', () => {
	it('wraps nodes in a schema.org @graph', () => {
		const doc = JSON.parse(serializeJsonLd([organizationSchema()]));
		expect(doc['@context']).toBe('https://schema.org');
		expect(doc['@graph']).toHaveLength(1);
		expect(doc['@graph'][0]['@id']).toBe(ORGANIZATION_ID);
	});

	it('cannot be broken out of its <script> element', () => {
		const json = serializeJsonLd([
			faqSchema([{ question: '</script><script>alert(1)</script>', answer: 'a & b' }])
		]);
		expect(json).not.toContain('<');
		expect(json).not.toContain('>');
		expect(json).not.toContain('&');
		// The escapes are valid JSON, so the data round-trips unchanged.
		const doc = JSON.parse(json);
		expect(doc['@graph'][0].mainEntity[0].name).toBe('</script><script>alert(1)</script>');
		expect(doc['@graph'][0].mainEntity[0].acceptedAnswer.text).toBe('a & b');
	});
});

describe('webApplicationSchema', () => {
	const app = webApplicationSchema({
		description: 'd',
		featureList: ['f'],
		screenshot: '/_app/immutable/assets/build.webp'
	});

	it('publishes the free, monthly and annual plans in USD', () => {
		const offers = app.offers as {
			name: string;
			price: number;
			priceCurrency: string;
			priceSpecification?: { billingDuration: string };
		}[];
		expect(offers.map((o) => [o.name, o.price])).toEqual([
			['Free', 0],
			['Monthly', 1],
			['Annual', 10]
		]);
		expect(offers.every((o) => o.priceCurrency === 'USD')).toBe(true);
		expect(offers[1].priceSpecification?.billingDuration).toBe('P1M');
		expect(offers[2].priceSpecification?.billingDuration).toBe('P1Y');
	});

	it('uses absolute URLs', () => {
		expect(app.screenshot).toBe('https://chessstack.app/_app/immutable/assets/build.webp');
		expect(app.image).toBe('https://chessstack.app/og-image.png');
	});
});

describe('articleSchema', () => {
	it('defaults dateModified to datePublished and links to the publisher', () => {
		const article = articleSchema('BlogPosting', {
			path: '/blog/post',
			headline: 'H',
			description: 'D',
			datePublished: '2026-03-25'
		});
		expect(article['@id']).toBe('https://chessstack.app/blog/post#article');
		expect(article.dateModified).toBe('2026-03-25');
		expect(article.publisher).toEqual({ '@id': ORGANIZATION_ID });
	});
});

describe('breadcrumbSchema', () => {
	it('numbers items from 1 with absolute URLs', () => {
		const crumbs = breadcrumbSchema([
			{ name: 'Home', path: '/' },
			{ name: 'Blog', path: '/blog' }
		]);
		expect(crumbs.itemListElement).toEqual([
			{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://chessstack.app/' },
			{ '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://chessstack.app/blog' }
		]);
	});
});
