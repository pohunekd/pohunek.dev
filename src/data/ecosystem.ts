import rawConfig from '../../releases.config.json';
import {
	findProduct,
	parseReleasesConfig,
	tagOf,
	type Product,
	type ReleasesConfig,
} from '../../scripts/lib/releases-config';

/** The pinned release of every ecosystem product, validated at build time. */
export const ecosystem: ReleasesConfig = parseReleasesConfig(rawConfig);

export type ProductId = 'pohunek' | 'companion' | 'android' | 'plugin' | 'launchers' | 'web';

export function product(id: ProductId): Product {
	return findProduct(ecosystem, id);
}

/** The pinned tag of a product, for example `v0.37.0` or `plugin-v0.7.3`. */
export function pinnedTag(id: ProductId): string {
	return tagOf(product(id));
}
