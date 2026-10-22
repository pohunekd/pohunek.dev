export type Status = 'shipped' | 'in-progress' | 'experimental' | 'design' | 'planned';

export const statusLabel: Record<Status, string> = {
	shipped: 'Shipped',
	'in-progress': 'In progress',
	experimental: 'Experimental',
	design: 'Design',
	planned: 'Planned',
};
