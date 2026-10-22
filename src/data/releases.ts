import { site } from '../config/site';

/**
 * Release versions the install commands on this site name. Every command was
 * checked against these assets: the archive names exist, `sha256sum -c` passes
 * and `gh attestation verify` succeeds.
 */
export const releases = {
	pohunek: site.release.replace(/^v/, ''),
	companion: '0.1.4',
	launchers: '0.4.0',
	plugin: '0.7.1',
	web: '0.3.1',
} as const;

const workRepo = 'zajca/pohunek-work';

/** Download, verify and unpack one release archive; `tag` and `archive` are full names. */
function fetchAndVerify(repo: string, tag: string, archive: string): string[] {
	return [
		`gh release download ${tag} -R ${repo} -p '${archive}*'`,
		`sha256sum -c ${archive}.sha256`,
		`gh attestation verify ${archive} --repo ${repo}`,
		`tar -xzf ${archive}`,
	];
}

const daemonArchive = `pohunek-daemon-${releases.pohunek}-x86_64-unknown-linux-gnu`;
const launchersArchive = `pohunek-launchers-${releases.launchers}-noarch`;
const pluginArchive = `pohunek-work-plugin-${releases.plugin}-noarch`;
const webArchive = `pohunek-web-${releases.web}-linux-x86_64`;

/** Shell lines for the install boxes. */
export const installCommands = {
	pohunekLinux: [
		...fetchAndVerify(site.repository, `v${releases.pohunek}`, `${daemonArchive}.tar.gz`),
		`cd ${daemonArchive}`,
		'./pohunek service check        # shows what will be installed where',
		'./packaging/install-daemon.sh  # installs the CLI and the login service',
		'pohunek doctor',
	],
	pohunekMacos: [site.homebrewInstall, 'pohunek service install', 'pohunek doctor'],

	/** Launcher scripts from the release archive, without pohunek-work. */
	launchersFromRelease: [
		...fetchAndVerify(workRepo, `launchers-v${releases.launchers}`, `${launchersArchive}.tar.gz`),
		`cd ${launchersArchive}`,
	],
	/** Launcher scripts from a source checkout. */
	launchersFromSource: ['git clone https://github.com/zajca/pohunek-work.git', 'cd pohunek-work/launchers'],
	/** Copies the scripts and templates into the XDG locations `pohunek-work setup` also uses. */
	launchersCopy: [
		'bin=${XDG_DATA_HOME:-$HOME/.local/share}/pohunek/bin',
		'cfg=${XDG_CONFIG_HOME:-$HOME/.config}',
		'install -d "$bin" "$cfg/pohunek/prompts" "$cfg/sway/config.d"',
		'install -m 755 pohunek-rofi pohunek-rofi-issue pohunek-launch-issue pohunek-launch-pr pohunek-new-session "$bin/"',
		'install -m 644 lib.sh "$bin/"',
		'cp -n templates/launcher.conf "$cfg/pohunek/"',
		'cp -n templates/prompts/*.tmpl "$cfg/pohunek/prompts/"',
		`printf 'bindsym $mod+p exec exec %s/pohunek-rofi\\n' "$bin" > "$cfg/sway/config.d/pohunek.conf"`,
		'swaymsg reload',
	],
	launchersWithWork: ['pohunek-work setup        # scripts, launcher.conf, prompts and the sway drop-in', 'pohunek-work doctor'],

	pluginLinux: [
		...fetchAndVerify(workRepo, `plugin-v${releases.plugin}`, `${pluginArchive}.tar.gz`),
		'mkdir -p ~/.local/lib ~/.local/bin',
		`rm -rf ~/.local/lib/pohunek-work && mv ${pluginArchive} ~/.local/lib/pohunek-work`,
		`printf '#!/bin/sh\\nexec bun "$HOME/.local/lib/pohunek-work/plugin/pohunek-work.js" "$@"\\n' > ~/.local/bin/pohunek-work`,
		'chmod +x ~/.local/bin/pohunek-work',
		'pohunek-work doctor',
	],

	webLinux: [
		...fetchAndVerify(workRepo, `web-v${releases.web}`, `${webArchive}.tar.gz`),
		`cd ${webArchive} && ./install.sh`,
		'$EDITOR ~/.config/pohunek/backend.env   # set POHUNEK_BACKEND_BIND_HOST (NetBird address) and POHUNEK_BACKEND_PORT',
		'systemctl --user daemon-reload',
		'systemctl --user enable --now pohunek-backend.service',
	],
	webMacos: ['brew install zajca/pohunek/pohunek-web'],
} as const;
