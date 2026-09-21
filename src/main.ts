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
import { obfuscate, deobfuscate } from './secure';
import { FindMyBookApi } from './api';
import { PAYLOAD_BLOCK } from './noteMeta';
import { SyncPayload, BookshelfDetailResponse, SortedBook } from './types';

/** 落盘的完整数据结构（服务器地址混淆存放） */
interface PersistedData {
	serverUrl?: string;
	syncFolder?: string;
	lastSyncAt?: number | null;
	baseline?: Record<string, CollectionSnapshot>;
	shelves?: BookshelfDetailResponse[];
	tags?: string[];
}

export default class FindMyBookPlugin extends Plugin {
	settings!: FindMyBookSettings;
	/** 每本书服务端藏书信息的基线，用于反向同步 diff 出用户改动 */
	baseline: Record<string, CollectionSnapshot> = {};
	/** 书架层/格结构缓存，供位置选择器离线使用 */
	shelves: BookshelfDetailResponse[] = [];
	/** 用户在小程序里定义的自定义标签，供书标签多选使用（后端按同一份清单校验） */
	tags: string[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();

		// 注册书架视图（参考 weread 的书架面板）
		this.registerView(
			VIEW_TYPE_FMB_BOOKSHELF,
			(leaf) => new BookshelfView(leaf, this),
		);

		// 注册书籍详情视图（点书架里的书进入）
		this.registerView(
			VIEW_TYPE_FMB_BOOK_DETAIL,
			(leaf) => new BookDetailView(leaf, this),
		);

		// 藏书笔记里的「选择摆放位置」按钮
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

		// 左侧 ribbon 图标：左键打开书架，右键菜单提供同步
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

		// 命令：打开书架视图
		this.addCommand({
			id: 'open-bookshelf',
			name: '打开书架',
			callback: () => this.activateBookshelfView(),
		});

		// 命令：正向同步（生成一次性二维码 -> 小程序扫码 -> 写入 vault）
		this.addCommand({
			id: 'sync',
			name: '同步到 Obsidian',
			callback: () => {
				void this.sync();
			},
		});

		// 命令：反向同步（把 Obsidian 里改过的藏书信息回传小程序）
		this.addCommand({
			id: 'reverse-sync',
			name: '反向同步（把 Obsidian 的修改传回小程序）',
			callback: () => {
				void this.reverseSync();
			},
		});

		// 命令：为当前笔记选择摆放位置
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

		// 设置页
		this.addSettingTab(new FindMyBookSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PersistedData> | null;
		// 只取已知字段：历史版本里的 token 等敏感字段会被自然丢弃
		this.settings = {
			serverUrl: raw?.serverUrl ? deobfuscate(raw.serverUrl) : DEFAULT_SETTINGS.serverUrl,
			syncFolder: raw?.syncFolder ?? DEFAULT_SETTINGS.syncFolder,
			lastSyncAt: raw?.lastSyncAt ?? DEFAULT_SETTINGS.lastSyncAt,
		};
		this.baseline = raw?.baseline ?? {};
		this.shelves = raw?.shelves ?? [];
		this.tags = raw?.tags ?? [];
	}

	async saveSettings(): Promise<void> {
		// 服务器地址以混淆串落盘，避免在 data.json 中明文可读
		await this.saveData({
			serverUrl: obfuscate(this.settings.serverUrl),
			syncFolder: this.settings.syncFolder,
			lastSyncAt: this.settings.lastSyncAt,
			baseline: this.baseline,
			shelves: this.shelves,
			tags: this.tags,
		} satisfies PersistedData);
	}

	/** 正向同步：弹出一次性二维码，等小程序扫码把当次数据送过来 */
	async sync(): Promise<void> {
		if (!this.settings.serverUrl) {
			new Notice('请先在设置中填写后端服务器地址');
			return;
		}
		// 护栏：正向同步会用服务器值覆盖可改字段，若本地有未回传的改动会丢失
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

	/** 反向同步：收集笔记里改过的藏书信息，扫码确认后回传小程序 */
	async reverseSync(): Promise<void> {
		if (!this.settings.serverUrl) {
			new Notice('请先在设置中填写后端服务器地址');
			return;
		}
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

	/** 收到后端下发的当次数据快照后写入 vault，更新基线/书架缓存，并刷新书架视图 */
	async applySyncPayload(payload: SyncPayload, sessionToken?: string): Promise<void> {
		const downloadCover = sessionToken ? this.makeCoverDownloader(sessionToken) : undefined;
		try {
			new Notice('正在写入 vault（含封面下载）…');
			const result = await syncAll(this, payload, downloadCover);
			this.baseline = result.baseline;
			this.shelves = result.shelves;
			// 载荷没带标签（旧后端）时不要清掉已缓存的清单
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

	/** 封面下载器：一律走会话封面端点取字节（插件端不接触封面 URL） */
	private makeCoverDownloader(token: string): CoverDownloader {
		const api = new FindMyBookApi(this.settings.serverUrl);
		return async (book: SortedBook) =>
			book.hasCover ? api.downloadCover(token, book.myBookId) : null;
	}

	/** 刷新所有已打开的书架视图 */
	refreshBookshelfViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FMB_BOOKSHELF)) {
			const view = leaf.view;
			if (view instanceof BookshelfView) {
				void view.refresh();
			}
		}
	}

	/** 打开（或聚焦）「书放哪了」书架视图：优先右侧栏（并展开），否则新标签页 */
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
			// 若放在右侧栏，确保展开（否则面板开了但看不见）
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

	/** 打开书籍详情页：复用已有的详情页 leaf（换书时只换状态），没有就开新标签页 */
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
