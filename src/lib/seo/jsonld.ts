// schema.org structured data (JSON-LD) for public pages.
//
// Each builder returns one node. Pages pass a list of nodes to <Seo jsonLd={...}>,
// which outputs them as a single @graph so nodes can point at each other by
// @id (e.g. a blog post's publisher is the Organization node).
//
// Test changes with https://search.google.com/test/rich-results and
// https://validator.schema.org.

import { DEFAULT_SOCIAL_IMAGE, LOGO_IMAGE, SITE_NAME, SITE_URL, absoluteUrl } from './site';
import type { SocialImage } from './site';
import { FREE_PLAN_SUMMARY, PAID_PLANS, PAID_PLAN_SUMMARY, PRICE_CURRENCY } from './pricing';

/** One schema.org node, without @context (serializeJsonLd adds it). */
export type JsonLdNode = { '@type': string } & Record<string, unknown>;

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const WEB_APP_ID = `${SITE_URL}/#app`;
export const BLOG_ID = `${SITE_URL}/blog#blog`;

/**
 * Serialises nodes into one JSON-LD document for a <script type="application/ld+json">.
 * <, > and & are escaped (valid JSON escapes) so no text, e.g. a blog title,
 * can close the surrounding script element.
 */
export function serializeJsonLd(nodes: JsonLdNode[]): string {
	return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026');
}

export function organizationSchema(): JsonLdNode {
	return {
		'@type': 'Organization',
		'@id': ORGANIZATION_ID,
		name: SITE_NAME,
		legalName: 'Chessstack LLC',
		url: `${SITE_URL}/`,
		logo: {
			'@type': 'ImageObject',
			url: absoluteUrl(LOGO_IMAGE.src),
			width: LOGO_IMAGE.width,
			height: LOGO_IMAGE.height
		},
		email: 'support@chessstack.app',
		sameAs: ['https://github.com/PvtTwinkle/Chessstack']
	};
}

/** Home page only: tells Google the site name to show in results. */
export function websiteSchema(): JsonLdNode {
	return {
		'@type': 'WebSite',
		'@id': WEBSITE_ID,
		url: `${SITE_URL}/`,
		name: SITE_NAME,
		// People search for "chess stack" as often as "chessstack" (Search Console).
		alternateName: ['Chess Stack', 'ChessStack'],
		inLanguage: 'en',
		publisher: { '@id': ORGANIZATION_ID }
	};
}

/** The app itself, with one Offer per plan (free, monthly, annual). */
export function webApplicationSchema(options: {
	description: string;
	featureList: string[];
	/** Root-relative or absolute URL of a product screenshot. */
	screenshot?: string;
}): JsonLdNode {
	const registerUrl = `${SITE_URL}/register`;
	return {
		'@type': 'WebApplication',
		'@id': WEB_APP_ID,
		name: SITE_NAME,
		url: `${SITE_URL}/`,
		description: options.description,
		applicationCategory: 'EducationalApplication',
		applicationSubCategory: 'Chess opening trainer',
		operatingSystem: 'Any',
		browserRequirements: 'Requires a modern web browser with JavaScript enabled',
		inLanguage: 'en',
		image: absoluteUrl(DEFAULT_SOCIAL_IMAGE.src),
		...(options.screenshot ? { screenshot: absoluteUrl(options.screenshot) } : {}),
		featureList: options.featureList,
		offers: [
			{
				'@type': 'Offer',
				name: 'Free',
				price: 0,
				priceCurrency: PRICE_CURRENCY,
				description: FREE_PLAN_SUMMARY,
				url: registerUrl
			},
			...PAID_PLANS.map((plan) => ({
				'@type': 'Offer',
				name: plan.name,
				price: plan.price,
				priceCurrency: PRICE_CURRENCY,
				description: PAID_PLAN_SUMMARY,
				url: registerUrl,
				priceSpecification: {
					'@type': 'UnitPriceSpecification',
					price: plan.price,
					priceCurrency: PRICE_CURRENCY,
					billingDuration: plan.billingDuration,
					unitCode: plan.unitCode
				}
			}))
		],
		publisher: { '@id': ORGANIZATION_ID }
	};
}

export function faqSchema(items: { question: string; answer: string }[]): JsonLdNode {
	return {
		'@type': 'FAQPage',
		mainEntity: items.map((item) => ({
			'@type': 'Question',
			name: item.question,
			acceptedAnswer: { '@type': 'Answer', text: item.answer }
		}))
	};
}

/** Breadcrumb trail, home first. Paths are root-relative. */
export function breadcrumbSchema(items: { name: string; path: string }[]): JsonLdNode {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: item.name,
			item: absoluteUrl(item.path)
		}))
	};
}

export interface ArticleInput {
	/** Root-relative path of the article page. */
	path: string;
	headline: string;
	description: string;
	/** ISO 8601 date, e.g. 2026-03-25. */
	datePublished: string;
	dateModified?: string;
	image?: SocialImage;
	/** @id of the collection the article belongs to, e.g. BLOG_ID. */
	isPartOf?: string;
}

/** A blog post or guide. Publisher is the Organization node, so include organizationSchema() too. */
export function articleSchema(type: 'Article' | 'BlogPosting', article: ArticleInput): JsonLdNode {
	const url = absoluteUrl(article.path);
	const image = article.image ?? DEFAULT_SOCIAL_IMAGE;
	return {
		'@type': type,
		'@id': `${url}#article`,
		headline: article.headline,
		description: article.description,
		url,
		mainEntityOfPage: url,
		datePublished: article.datePublished,
		dateModified: article.dateModified ?? article.datePublished,
		image: {
			'@type': 'ImageObject',
			url: absoluteUrl(image.src),
			width: image.width,
			height: image.height
		},
		inLanguage: 'en',
		author: { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` },
		publisher: { '@id': ORGANIZATION_ID },
		...(article.isPartOf ? { isPartOf: { '@id': article.isPartOf } } : {})
	};
}

/** The /blog index, listing its posts. */
export function blogSchema(options: {
	description: string;
	posts: { path: string; headline: string; datePublished: string; dateModified?: string }[];
}): JsonLdNode {
	return {
		'@type': 'Blog',
		'@id': BLOG_ID,
		name: `${SITE_NAME} Blog`,
		url: absoluteUrl('/blog'),
		description: options.description,
		inLanguage: 'en',
		publisher: { '@id': ORGANIZATION_ID },
		blogPost: options.posts.map((post) => ({
			'@type': 'BlogPosting',
			'@id': `${absoluteUrl(post.path)}#article`,
			headline: post.headline,
			url: absoluteUrl(post.path),
			datePublished: post.datePublished,
			dateModified: post.dateModified ?? post.datePublished
		}))
	};
}
