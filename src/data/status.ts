export type Status = 'shipped' | 'in-progress' | 'design' | 'planned';

export const statusLabel: Record<Status, string> = {
	shipped: 'Shipped',
	'in-progress': 'In progress',
	design: 'Design',
	planned: 'Planned',
};
