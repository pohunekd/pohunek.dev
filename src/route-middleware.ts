import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { productNavigation } from './lib/docs-navigation';

// Starlight builds one sidebar from every product's entries; each docs page shows only its own product's part.
export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	const navigation = productNavigation(route, context.url.pathname);
	route.sidebar = navigation.sidebar;
	route.pagination = navigation.pagination;
});
