import { App, Modal, Notice, TFile, Setting } from 'obsidian';
import type FindMyBookPlugin from '../main';
import { BookshelfDetailResponse, BookGridInfo } from '../types';
import {
	FM,
	NotePayload,
	emptyPayload,
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
		const max = (grid.bookCount ?? 0) + 1;
		for (let i = 1; i <= max; i++) {
			this.indexEl.createEl('option', { value: String(i), text: `第 ${i} 本` });
		}
		if (preferIndex != null) {
			const v = String(preferIndex + 1);
			if (Number(v) <= max) this.indexEl.value = v;
		}
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

		new Notice('位置已写入笔记；用「反向同步」回传小程序后生效');
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
