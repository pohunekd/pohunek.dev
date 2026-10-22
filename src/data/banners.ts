import type { ImageMetadata } from 'astro';
import banner404 from '../assets/brand/banner-404.png';
import bannerAndroid from '../assets/brand/banner-android.png';
import bannerCompanion from '../assets/brand/banner-companion.png';
import bannerDocs from '../assets/brand/banner-docs.png';
import bannerInstall from '../assets/brand/banner-install.png';
import bannerPlugins from '../assets/brand/banner-plugins.png';
import bannerRoadmap from '../assets/brand/banner-roadmap.png';
import bannerSurfaces from '../assets/brand/banner-surfaces.png';
import bannerSway from '../assets/brand/banner-sway.png';
import bannerTui from '../assets/brand/banner-tui.png';
import bannerWeb from '../assets/brand/banner-web.png';
import bannerWhy from '../assets/brand/banner-why.png';

/** An engraving shown beside a page hero; `credit` names third-party material in it. */
export interface Banner {
	image: ImageMetadata;
	alt: string;
	caption: string;
	credit?: string;
}

const androidRobotCredit =
	'The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the Creative Commons 3.0 Attribution License.';

export const banners = {
	why: {
		image: bannerWhy,
		alt: 'Engraving: the farmhand naps in a haystack with his cap over his eyes while three server cabinets plow straight furrows on their own. A salesman in a top hat waves an ornate console full of dials at him, and nobody looks.',
		caption: 'The salesman brought a better view of the plow.',
	},
	surfaces: {
		image: bannerSurfaces,
		alt: 'Engraving: onlookers lean on a fence to watch three server cabinets plow the field: the farmhand with a spyglass, a farm girl with a chalk slate, a copper Android robot holding a phone, and a cat sitting on a tiny terminal.',
		caption: 'Everyone watches the field in their own way.',
		credit: androidRobotCredit,
	},
	companion: {
		image: bannerCompanion,
		alt: 'Engraving: the farmhand steers a plow pulled by three server cabinets labelled codex, claude and hermes. A farm girl with a chalk slate of ticks and one exclamation mark points at the claude cabinet, which has stopped in the furrow with steam rising from it.',
		caption: 'The companion notices which one stopped.',
	},
	android: {
		image: bannerAndroid,
		alt: 'Engraving: the farmhand naps under a tree with his whip put aside, while a small copper Android robot holds up a screen and keeps watch over three server cabinets plowing the field on their own.',
		caption: 'Take a nap. The phone keeps watch.',
		credit: androidRobotCredit,
	},
	tui: {
		image: bannerTui,
		alt: 'Engraving: the farmhand sits on a hay bale typing on an old green-screen terminal set on a crate, with a cat asleep on top of the warm monitor, while three server cabinets plow in the background.',
		caption: 'One terminal is enough. The cat agrees.',
	},
	sway: {
		image: bannerSway,
		alt: 'Engraving: at a crossroads signpost with many arrows and a notice board tiled into neat rectangles, the farmhand throws a switch lever, and three server cabinets march off in a row down the road he picked.',
		caption: 'One key, and the herd turns.',
	},
	web: {
		image: bannerWeb,
		alt: 'Engraving: the farmhand on a ladder nails a blank sign onto a half-built wooden stall covered in scaffolding, while the server cabinets hold the rope, carry planks and guard a bucket of nails.',
		caption: 'Still under construction. Bring a hammer.',
	},
	plugins: {
		image: bannerPlugins,
		alt: 'Engraving: in a blacksmith forge the farmhand, in a leather apron, fits a new harness onto a fourth server cabinet with a blank name plate, while the codex, claude and hermes cabinets stand by in theirs.',
		caption: 'A new animal joins the team. It only needs a harness.',
	},
	roadmap: {
		image: bannerRoadmap,
		alt: 'Engraving: the farmhand and a farm girl kneel over a hand-drawn map of the fields with dotted paths and little flags, and the girl plants a flag in the soil while three server cabinets wait in harness.',
		caption: 'Next season’s fields are already staked out.',
	},
	install: {
		image: bannerInstall,
		alt: 'Engraving: a farm girl checks the red wax seal of a delivered crate through a magnifying glass while the farmhand waits with a crowbar; a new server cabinet peeks out between the slats.',
		caption: 'Check the seal before you open the crate.',
	},
	docs: {
		image: bannerDocs,
		alt: 'Engraving: by lantern light in the barn the farmhand reads a thick almanac while the codex, claude and hermes cabinets lean over his shoulders, their green screens lighting the pages; a cat sleeps on a crate.',
		caption: 'Read the almanac once. The herd reads it every day.',
	},
	notFound: {
		image: banner404,
		alt: 'Engraving: the farmhand scratches his head holding a map upside down, while a server cabinet with a question mark on its screen has wandered off to the edge of a cliff beside a duck pond and a broken fence.',
		caption: 'He swears the map was right.',
	},
} as const satisfies Record<string, Banner>;

/** The banner of a page keyed by a runtime string, such as a surface slug. */
export function getBanner(key: string): Banner {
	if (!Object.hasOwn(banners, key)) {
		throw new Error(`No banner for: ${key}`);
	}
	return banners[key as keyof typeof banners];
}
