import {
	parseProductChangelog,
	type ChangelogRelease,
	type ProductChangelog,
} from '../../scripts/lib/changelog';
import type { Product } from '../../scripts/lib/releases-config';
import { renderReleaseMarkdown } from '../lib/release-markdown';
import { ecosystem } from './ecosystem';

/** One release in the ecosystem timeline, with its body already rendered to safe HTML. */
export interface TimelineEntry {
	readonly product: Product;
	readonly release: ChangelogRelease;
	readonly html: string;
}

const files = import.meta.glob<unknown>('./changelog/*.json', { eager: true, import: 'default' });

function loadChangelogs(): Map<string, ProductChangelog> {
	const byProduct = new Map<string, ProductChangelog>();
	for (const [path, raw] of Object.entries(files)) {
		const changelog = parseProductChangelog(raw, path);
		if (path !== `./changelog/${changelog.product}.json`) {
			throw new Error(`${path} holds the changelog of "${changelog.product}"`);
		}
		byProduct.set(changelog.product, changelog);
	}
	for (const product of ecosystem.products) {
		if (!byProduct.has(product.id)) {
			throw new Error(`src/data/changelog/${product.id}.json is missing; run scripts/follow-releases.ts`);
		}
	}
	return byProduct;
}

const changelogs = loadChangelogs();

/** Release headings are h3 on the changelog pages, so body headings sit one level below. */
const BODY_HEADING_DEPTH = 4;

/** Every recorded release of the given products, newest publication first. */
export function timeline(products: readonly Product[] = ecosystem.products): TimelineEntry[] {
	return products
		.flatMap((product) =>
			(changelogs.get(product.id)?.releases ?? []).map((release) => ({
				product,
				release,
				html: renderReleaseMarkdown(release.markdown, BODY_HEADING_DEPTH),
			})),
		)
		.sort((a, b) => Date.parse(b.release.publishedAt) - Date.parse(a.release.publishedAt));
}
