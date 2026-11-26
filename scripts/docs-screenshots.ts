// Retakes doc-site screenshots from the running dev server (`pnpm dev`), in a fresh browser
// profile seeded with fixture designs, so the images follow the current UI.
//   pnpm screenshots:capture            -> every set
//   pnpm screenshots:capture assemblies -> only the named sets
// BASE_URL overrides http://localhost:5173. Writes lossless WebP under static/screenshots/guide/.
// See docs/dev-tooling.md § Doc-site screenshots.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
// SCREENSHOTS_OUT keeps PNGs in another folder (for trying a set out) instead of the doc site.
const OUT_ROOT = process.env.SCREENSHOTS_OUT ?? 'static/screenshots/guide';
const VIEWPORT = { width: 1440, height: 900 };

interface ScreenshotSet {
	/** Folder under static/screenshots/guide, named after the guide page's slug. */
	name: string;
	run(page: Page, shot: (file: string, target?: Locator | Clip) => Promise<void>): Promise<void>;
}
type Locator = ReturnType<Page['locator']>;
interface Clip {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Seeds IndexedDB with two single-Part designs (a 6-helix arm and an 18-helix base) and an
 * assembly linking both, built with the app's own model and storage modules (served by Vite), so
 * the fixture always has the current format. "Arm" is changed after it was linked, so its link
 * shows as outdated.
 */
async function seedAssembly(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const load = (path: string) => import(/* @vite-ignore */ path);
		const { default: FoldnanoDocument } = await load('/src/lib/model/document.svelte.ts');
		const { Part } = await load('/src/lib/model/Part/index.ts');
		const { linkFromSource, linkedPartJson } = await load('/src/lib/model/partLinks.ts');
		const { StorageManager } = await load('/src/lib/services/storage/StorageManager.ts');
		const { IndexedDbStorageProvider } = await load(
			'/src/lib/services/storage/providers/IndexedDbStorageProvider.ts'
		);
		const storage = new StorageManager('indexedDB');
		storage.registerProvider('indexedDB', new IndexedDbStorageProvider());

		const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4'];
		function bundle(id: string, name: string, cols: number, rows: number, length: number) {
			const doc = new FoldnanoDocument(id, name);
			const part = doc.addPart(Part.forType('HONEYCOMB', name, undefined, length));
			const region = part.getDefaultRegion();
			let n = 0;
			for (let row = 0; row < rows; row++) {
				for (let col = 0; col < cols; col++) {
					const vh = region.addVhAtCoords(part, col, row);
					part.createOligo(vh, 0, length - 1, '#0066cc');
					part.createOligo(vh, length - 1, 0, COLORS[n++ % COLORS.length]);
				}
			}
			return doc;
		}
		const base = bundle('docs-base', 'Base', 6, 3, 84);
		const arm = bundle('docs-arm', 'Arm', 3, 2, 126);

		const assembly = new FoldnanoDocument('docs-assembly', 'Hinge assembly');
		const turn = (deg: number) => {
			const half = (deg * Math.PI) / 360;
			return [0, Math.sin(half), 0, Math.cos(half)];
		};
		const placements: [typeof base, { x: number; y: number; z: number }[], number[][]][] = [
			[base, [{ x: 0, y: 0, z: 0 }], [turn(0)]],
			[
				arm,
				[
					{ x: -1, y: 0, z: 29 },
					{ x: 9, y: 0, z: 29 },
				],
				[turn(-25), turn(25)],
			],
		];
		for (const [source, positions, rotations] of placements) {
			const link = await linkFromSource(source, { docId: source.id });
			const part = assembly.addPart(
				Part.fromJSON(linkedPartJson(link.json, link.source, source.name))
			);
			positions.forEach((position, i) => {
				const transform = { position, quaternion: rotations[i] };
				if (i === 0) {
					assembly.assembly.occurrences.find(
						(o: { partId: string }) => o.partId === part.id
					).transform = transform;
				} else {
					const name = assembly.assembly.nextOccurrenceName(source.name);
					assembly.assembly.add(part.id, name, { transform });
				}
			});
		}
		await storage.saveDocument(base.id, base.snapshot());
		await storage.saveDocument(assembly.id, assembly.snapshot());
		const edited = arm.snapshot();
		edited.parts[0].oligos[1].color = '#808000';
		await storage.saveDocument(arm.id, edited);
		return assembly.id;
	});
}

/** Closes the first-visit welcome and the privacy notice; both remember it in a cookie. */
async function dismissFirstVisit(page: Page): Promise<void> {
	const welcome = page.getByText('Welcome to Foldnano.');
	const shown = await welcome
		.waitFor({ timeout: 15_000 })
		.then(() => true)
		.catch(() => false);
	if (shown) {
		await page.keyboard.press('Escape');
		await welcome.waitFor({ state: 'hidden' });
	}
	const gotIt = page.getByRole('button', { name: 'Got it' });
	if (await gotIt.isVisible()) await gotIt.click();
}

/** Opens a design in the editor and waits for its views to settle. */
async function openEditor(page: Page, docId: string): Promise<void> {
	await page.goto(`${BASE_URL}/editor/${docId}`);
	await dismissFirstVisit(page);
	await page.waitForLoadState('networkidle');
}

const sets: ScreenshotSet[] = [
	{
		name: 'assemblies',
		async run(page, shot) {
			const docId = await seedAssembly(page);
			await openEditor(page, docId);
			await page.getByRole('button', { name: 'Toggle Assembly panel' }).click();
			// The editor's pane handles (paneforge): before the plane pane and before the strand view.
			const paneHandles = page.locator('[data-pane-resizer]');
			const paneHandle = paneHandles.last();
			const planeStart = (await paneHandles.nth((await paneHandles.count()) - 2).boundingBox())!;
			// The Plane/3D switch shows once the plane pane is the active viewer.
			await page.mouse.click(planeStart.x + 100, planeStart.y + planeStart.height - 100);
			await page.getByTitle('Show 3D view').click();
			// Widen the 3D pane with the keyboard on its handle.
			await paneHandle.focus();
			for (let i = 0; i < 40; i++) {
				await page.keyboard.press('ArrowRight');
				if (((await paneHandle.boundingBox())?.x ?? 0) >= 1000) break;
			}
			const box = (await paneHandle.boundingBox())!;
			await page.waitForTimeout(500);
			// Look from the front (the view cube frames everything), then orbit a little.
			await page.getByRole('button', { name: 'Front (from −Y) view' }).click();
			await page.waitForTimeout(1200);
			const view = { x: box.x - 200, y: 500 };
			await page.mouse.move(view.x, view.y);
			await page.mouse.down();
			await page.mouse.move(view.x + 30, view.y - 12, { steps: 10 });
			await page.mouse.up();
			await page.waitForTimeout(1500);
			// The side panel and the 3D view, without the toolbars and the status bar.
			const top = box.y - 10;
			await shot('01-assembly-3d', {
				x: 0,
				y: top,
				width: box.x,
				height: box.y + box.height - top,
			});

			await page.getByRole('button', { name: 'Actions for Arm', exact: true }).click();
			const menu = page.getByRole('menu');
			await menu.waitFor();
			await page.waitForTimeout(400);
			const menuBox = (await menu.boundingBox())!;
			await shot('02-linked-part-menu', {
				x: 0,
				y: top,
				width: menuBox.x + menuBox.width + 16,
				height: menuBox.y + menuBox.height + 16 - top,
			});
			await page.keyboard.press('Escape');

			await page.getByRole('button', { name: 'Link Part' }).click();
			const dialog = page.getByRole('dialog');
			await dialog.waitFor();
			await page.waitForTimeout(800);
			await shot('03-insert-part-dialog', dialog);
		},
	},
];

async function main() {
	try {
		await fetch(BASE_URL);
	} catch {
		console.error(`No dev server at ${BASE_URL}. Start it with \`pnpm dev\` first.`);
		process.exit(1);
	}
	const wanted = process.argv.slice(2);
	const chosen = wanted.length ? sets.filter((set) => wanted.includes(set.name)) : sets;
	// Playwright's own Chromium when installed, else the installed Chrome (in a fresh profile).
	const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
	const written: string[] = [];
	try {
		for (const set of chosen) {
			const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
			const page = await context.newPage();
			await page.goto(`${BASE_URL}/editor`);
			const dir = `${OUT_ROOT}/${set.name}`;
			mkdirSync(dir, { recursive: true });
			await set.run(page, async (file, target) => {
				const path = `${dir}/${file}.png`;
				if (target && 'width' in target) await page.screenshot({ path, clip: target });
				else await (target ?? page).screenshot({ path });
				written.push(path);
			});
			await context.close();
		}
	} finally {
		await browser.close();
	}
	if (written.length && !process.env.SCREENSHOTS_OUT)
		execFileSync('sh', ['scripts/screenshots-to-webp.sh', ...written], { stdio: 'inherit' });
}

await main();
