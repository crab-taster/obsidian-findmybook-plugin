import { Plugin, Notice, Menu, TFile } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	FindMyBookSettings,
	FindMyBookSettingTab,
} from './settings';
import { SyncSessionModal } from './ui/SyncSessionModal';
import { ReverseSyncModal } from './ui/ReverseSyncModal';
import { PositionPickerModal } from './ui/PositionPickerModal';
import { BookshelfView, VIEW_TYPE_FMB_BOOKSHELF } from './ui/BookshelfView';
import { BookDetailView, VIEW_TYPE_FMB_BOOK_DETAIL } from './ui/BookDetailView';
import { syncAll, CollectionSnapshot, CoverDownloader } from './sync';
import { collectEdits } from './reverse';
import { FindMyBookApi, SERVER_URL } from './api';
import { PAYLOAD_BLOCK } from './noteMeta';
import { SyncPayload, BookshelfDetailResponse, SortedBook } from './types';

interface PersistedData {
	syncFolder?: string;
	lastSyncAt?: number | null;
	baseline?: Record<string, CollectionSnapshot>;
	shelves?: BookshelfDetailResponse[];
	tags?: string[];
}

export default class FindMyBookPlugin extends Plugin {
	settings!: FindMyBookSettings;
	baseline: Record<string, CollectionSnapshot> = {};
	shelves: BookshelfDetailResponse[] = [];
	tags: string[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_FMB_BOOKSHELF,
			(leaf) => new BookshelfView(leaf, this),
		);

		this.registerView(
			VIEW_TYPE_FMB_BOOK_DETAIL,
			(leaf) => new BookDetailView(leaf, this),
		);

		this.registerMarkdownCodeBlockProcessor(PAYLOAD_BLOCK, (_source, el, ctx) => {
			const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			if (!(file instanceof TFile)) return;
			const btn = el.createEl('button', {
				cls: 'fmb-position-btn',
				text: '选择摆放位置',
			});
			btn.addEventListener('click', () => {
				new PositionPickerModal(this.app, this, file).open();
			});
		});

		const ribbon = this.addRibbonIcon('library', '书放哪了', () => {
			void this.activateBookshelfView();
		});
		ribbon.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item.setTitle('打开书架').setIcon('library').onClick(() => {
					void this.activateBookshelfView();
				}),
			);
		menu.addItem((item) =>
			item.setTitle('同步到 Obsidian').setIcon('refresh-cw').onClick(() => {
				void this.sync();
			}),
		);
		menu.addItem((item) =>
			item.setTitle('反向同步（回传修改）').setIcon('upload').onClick(() => {
				void this.reverseSync();
			}),
		);
			menu.showAtMouseEvent(e);
		});

		this.addCommand({
			id: 'open-bookshelf',
			name: '打开书架',
			callback: () => this.activateBookshelfView(),
		});

		this.addCommand({
			id: 'sync',
			name: '同步到 Obsidian',
			callback: () => {
				void this.sync();
			},
		});

		this.addCommand({
			id: 'reverse-sync',
			name: '反向同步（把 Obsidian 的修改传回小程序）',
			callback: () => {
				void this.reverseSync();
			},
		});

		this.addCommand({
			id: 'pick-position',
			name: '为当前笔记选择摆放位置',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) new PositionPickerModal(this.app, this, file).open();
				return true;
			},
		});

		this.addSettingTab(new FindMyBookSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PersistedData> | null;
		this.settings = {
			syncFolder: raw?.syncFolder ?? DEFAULT_SETTINGS.syncFolder,
			lastSyncAt: raw?.lastSyncAt ?? DEFAULT_SETTINGS.lastSyncAt,
		};
		this.baseline = raw?.baseline ?? {};
		this.shelves = raw?.shelves ?? [];
		this.tags = raw?.tags ?? [];
	}

	async saveSettings(): Promise<void> {
		await this.saveData({
			syncFolder: this.settings.syncFolder,
			lastSyncAt: this.settings.lastSyncAt,
			baseline: this.baseline,
			shelves: this.shelves,
			tags: this.tags,
		} satisfies PersistedData);
	}

	async sync(): Promise<void> {
		const pending = await collectEdits(this.app, this.settings.syncFolder, this.baseline);
		if (pending.edits.length > 0) {
			new Notice(
				`检测到 ${pending.edits.length} 本书有未回传的修改，` +
					`已阻止同步以免覆盖。请先执行「反向同步」把它们传回小程序。`,
				8000,
			);
			return;
		}
		new SyncSessionModal(this.app, this).open();
	}

	async reverseSync(): Promise<void> {
		const { edits, fileById } = await collectEdits(
			this.app,
			this.settings.syncFolder,
			this.baseline,
		);
		if (edits.length === 0) {
			new Notice('没有检测到需要回传的改动');
			return;
		}
		new ReverseSyncModal(this.app, this, edits, fileById).open();
	}

	async applySyncPayload(payload: SyncPayload, sessionToken?: string): Promise<void> {
		const downloadCover = sessionToken ? this.makeCoverDownloader(sessionToken) : undefined;
		try {
			new Notice('正在写入 vault（含封面下载）…');
			const result = await syncAll(this, payload, downloadCover);
			this.baseline = result.baseline;
			this.shelves = result.shelves;
			if (payload.tags) this.tags = result.tags;
			await this.saveSettings();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice('同步写入失败：' + msg);
			console.error('[findmybook] 同步写入失败', e);
			return;
		}
		this.refreshBookshelfViews();
	}

	private makeCoverDownloader(token: string): CoverDownloader {
		const api = new FindMyBookApi(SERVER_URL);
		return async (book: SortedBook) =>
			book.hasCover ? api.downloadCover(token, book.myBookId) : null;
	}

	refreshBookshelfViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FMB_BOOKSHELF)) {
			const view = leaf.view;
			if (view instanceof BookshelfView) {
				void view.refresh();
			}
		}
	}

	async activateBookshelfView(): Promise<void> {
		const { workspace } = this.app;
		try {
			let leaf = workspace.getLeavesOfType(VIEW_TYPE_FMB_BOOKSHELF)[0];
			if (!leaf) {
				leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf('tab');
				await leaf.setViewState({
					type: VIEW_TYPE_FMB_BOOKSHELF,
					active: true,
				});
			}
			if (leaf.getRoot() === workspace.rightSplit) {
				workspace.rightSplit.expand();
			}
			workspace.setActiveLeaf(leaf, { focus: true });
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice('打开书架失败：' + msg);
			console.error('[findmybook] 打开书架失败', e);
		}
	}

	async openBookDetail(file: TFile): Promise<void> {
		const { workspace } = this.app;
		try {
			const existing = workspace.getLeavesOfType(VIEW_TYPE_FMB_BOOK_DETAIL)[0];
			const leaf = existing ?? workspace.getLeaf('tab');
			await leaf.setViewState({
				type: VIEW_TYPE_FMB_BOOK_DETAIL,
				active: true,
				state: { path: file.path },
			});
			workspace.setActiveLeaf(leaf, { focus: true });
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice('打开书籍详情失败：' + msg);
			console.error('[findmybook] 打开书籍详情失败', e);
		}
	}
}
