import { App, Modal, Notice, TFile, Setting } from 'obsidian';
import type FindMyBookPlugin from '../main';
import { BookshelfDetailResponse, BookGridInfo } from '../types';
import {
	FM,
	NotePayload,
	emptyPayload,
	isFindMyBookNote,
	locationString,
	parsePayload,
	upsertPayloadBlock,
} from '../noteMeta';

export class PositionPickerModal extends Modal {
	private plugin: FindMyBookPlugin;
	private file: TFile;
	private shelfEl!: HTMLSelectElement;
	private gridEl!: HTMLSelectElement;
	private indexEl!: HTMLSelectElement;
	private originGridId: number | null = null;
	private gridCounts = new Map<number, number>();
	onSaved?: (location: string) => void;

	constructor(app: App, plugin: FindMyBookPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: '选择摆放位置' });

		if (this.plugin.shelves.length === 0) {
			contentEl.createEl('p', {
				text: '暂无书架结构缓存，请先「同步」一次再设置位置。',
			});
			return;
		}

		const cur = await this.readCurrentPayload();
		this.originGridId = cur.gridId;
		await this.scanGridCounts();
		const curShelf = cur.bookshelfId;
		const curGrid = cur.gridId;
		const curIndex = cur.bookIndexInGrid;

		new Setting(contentEl).setName('书架').addDropdown((dd) => {
			for (const shelf of this.plugin.shelves) {
				dd.addOption(String(shelf.id), shelf.name);
			}
			if (curShelf != null) dd.setValue(String(curShelf));
			this.shelfEl = dd.selectEl;
			dd.onChange(() => this.populateGrids());
		});

		new Setting(contentEl).setName('层 / 格').addDropdown((dd) => {
			this.gridEl = dd.selectEl;
			dd.onChange(() => this.populateIndices());
		});

		new Setting(contentEl).setName('摆放次序').addDropdown((dd) => {
			this.indexEl = dd.selectEl;
		});

		this.populateGrids(curGrid, curIndex);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('保存位置')
				.setCta()
				.onClick(() => {
					void this.save();
				}),
		);
	}

	private async readCurrentPayload(): Promise<NotePayload> {
		try {
			return parsePayload(await this.app.vault.cachedRead(this.file));
		} catch {
			return emptyPayload();
		}
	}

	private currentShelf(): BookshelfDetailResponse | undefined {
		const id = Number(this.shelfEl.value);
		return this.plugin.shelves.find((s) => s.id === id);
	}

	private populateGrids(preferGrid?: number | null, preferIndex?: number | null): void {
		const shelf = this.currentShelf();
		this.gridEl.empty();
		if (!shelf) return;
		for (const g of shelf.grids) {
			this.gridEl.createEl('option', { value: String(g.id), text: g.gridPosition });
		}
		if (preferGrid != null) this.gridEl.value = String(preferGrid);
		this.populateIndices(preferIndex);
	}

	private populateIndices(preferIndex?: number | null): void {
		const shelf = this.currentShelf();
		const grid = this.currentGrid();
		this.indexEl.empty();
		if (!shelf || !grid) return;
		const inThisGrid = this.originGridId != null && this.originGridId === grid.id;
		const base = this.gridCounts.get(grid.id) ?? 0;
		const max = Math.max(1, base + (inThisGrid ? 0 : 1));
		for (let i = 1; i <= max; i++) {
			this.indexEl.createEl('option', { value: String(i), text: `第 ${i} 本` });
		}
		const pick = inThisGrid && preferIndex != null ? preferIndex + 1 : max;
		this.indexEl.value = String(Math.min(Math.max(pick, 1), max));
	}

	private currentGrid(): BookGridInfo | undefined {
		const shelf = this.currentShelf();
		if (!shelf) return undefined;
		const id = Number(this.gridEl.value);
		return shelf.grids.find((g) => g.id === id);
	}

	private async save(): Promise<void> {
		const shelf = this.currentShelf();
		const grid = this.currentGrid();
		if (!shelf || !grid) {
			new Notice('请选择书架与层/格');
			return;
		}
		const pos1 = Number(this.indexEl.value);
		const index0 = pos1 - 1;
		const location = locationString(
			shelf.name,
			grid.layerIndex,
			grid.positionInLayer,
			pos1,
		);

		await this.app.fileManager.processFrontMatter(
			this.file,
			(fm: Record<string, unknown>) => {
				fm[FM.location] = location;
			},
		);
		await this.app.vault.process(this.file, (text) =>
			upsertPayloadBlock(text, {
				bookshelfId: shelf.id,
				gridId: grid.id,
				bookIndexInGrid: index0,
			}),
		);

		const moved = await this.reflowGrid(shelf, grid, index0);
		new Notice(
			'位置已写入笔记；用「反向同步」回传小程序后生效' +
				(moved > 0 ? `（已顺移本格 ${moved} 本书的摆放次序）` : ''),
		);
		this.onSaved?.(location);
		this.close();
	}

	private async scanGridCounts(): Promise<void> {
		const counts = new Map<number, number>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm || !isFindMyBookNote(fm)) continue;
			const p = parsePayload(await this.app.vault.cachedRead(file));
			if (p.gridId == null) continue;
			counts.set(p.gridId, (counts.get(p.gridId) ?? 0) + 1);
		}
		this.gridCounts = counts;
	}

	private async reflowGrid(
		shelf: BookshelfDetailResponse,
		grid: BookGridInfo,
		index0: number,
	): Promise<number> {
		const others: Array<{ file: TFile; index: number }> = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path === this.file.path) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm || !isFindMyBookNote(fm)) continue;
			const p = parsePayload(await this.app.vault.cachedRead(file));
			if (p.gridId !== grid.id) continue;
			others.push({ file, index: p.bookIndexInGrid ?? 0 });
		}
		others.sort((a, b) => a.index - b.index);

		const seq: Array<{ file: TFile; index: number | null }> = others.map((o) => ({
			file: o.file,
			index: o.index,
		}));
		seq.splice(index0, 0, { file: this.file, index: null });

		let moved = 0;
		for (let i = 0; i < seq.length; i++) {
			const entry = seq[i];
			if (!entry || entry.file.path === this.file.path) continue;
			const loc = locationString(
				shelf.name,
				grid.layerIndex,
				grid.positionInLayer,
				i + 1,
			);
			const fmNow = this.app.metadataCache.getFileCache(entry.file)?.frontmatter;
			const raw = fmNow?.[FM.location] as unknown;
			const before = typeof raw === 'string' ? raw : '';
			const indexChanged = entry.index !== i;
			if (!indexChanged && before === loc) continue;
			if (before !== loc) {
				await this.app.fileManager.processFrontMatter(
					entry.file,
					(fm: Record<string, unknown>) => {
						fm[FM.location] = loc;
					},
				);
			}
			if (indexChanged) {
				await this.app.vault.process(entry.file, (text) =>
					upsertPayloadBlock(text, { bookIndexInGrid: i }),
				);
			}
			moved++;
		}
		return moved;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
