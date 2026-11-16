import type { StarlightRouteData } from '@astrojs/starlight/route-data';

type SidebarEntry = StarlightRouteData['sidebar'][number];
type Navigation = Pick<StarlightRouteData, 'sidebar' | 'pagination'>;

function firstHref(entry: SidebarEntry): string | undefined {
	if (entry.type === 'link') {
		return entry.href;
	}
	for (const child of entry.entries) {
		const href = firstHref(child);
		if (href !== undefined) {
			return href;
		}
	}
	return undefined;
}

/**
 * The sidebar and previous/next links of the product a docs page belongs to. Every product's docs live under
 * their own first path segment (the routePrefix of docs-sync.config.json), and each top-level sidebar entry
 * belongs to the product of its first link.
 */
export function productNavigation(navigation: Navigation, pathname: string): Navigation {
	const prefix = `/${pathname.split('/')[1] ?? ''}/`;
	const own = (href: string | undefined): boolean => href !== undefined && href.startsWith(prefix);
	return {
		sidebar: navigation.sidebar.filter((entry) => own(firstHref(entry))),
		pagination: {
			prev: own(navigation.pagination.prev?.href) ? navigation.pagination.prev : undefined,
			next: own(navigation.pagination.next?.href) ? navigation.pagination.next : undefined,
		},
	};
}
