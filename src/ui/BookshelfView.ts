import { ItemView, Menu, TFile, WorkspaceLeaf } from 'obsidian';
import type FindMyBookPlugin from '../main';
import {
	FM,
	READING_STATUS_LABELS,
	STATUS_LABELS,
	isFindMyBookNote,
	shelfNameOf,
} from '../noteMeta';

export const VIEW_TYPE_FMB_BOOKSHELF = 'fmb-bookshelf-view';

/** frontmatter 取值转字符串（缺失或非字符串时返回空串） */
function s(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return '';
}

/** 非空、去重、按中文排序（下拉选项用） */
function uniqSorted(values: string[]): string[] {
	return Array.from(new Set(values.filter((v) => v !== ''))).sort((a, b) =>
		a.localeCompare(b, 'zh'),
	);
}

type SortKey = 'title' | 'author' | 'clc' | 'collectionDate';

/** 排序方式：对齐小程序「找书」的排序维度（最近访问/录入时间本地没有，用购入日期替代） */
const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
	{ value: 'title', label: '按书名' },
	{ value: 'author', label: '按作者' },
	{ value: 'clc', label: '按中图分类' },
	{ value: 'collectionDate', label: '按购入日期（新→旧）' },
];

interface BookCard {
	file: TFile;
	title: string;
	author: string;
	publisher: string;
	isbn: string;
	category: string;
	tags: string[];
	/** 书架名：从「摆放位置」串尾部剥掉层/列/本得到，未上架为空 */
	shelf: string;
	location: string;
	status: string;
	readingStatus: string;
	clcNumber: string;
	collectionDate: string;
	/** 已下载到 vault 的本地封面路径（封面 URL 不再同步到插件） */
	localCover: string;
}

/**
 * 「书放哪了」书架视图：参考 weread 插件的书架网格面板。
 *
 * 读取 vault 中同步目录下的藏书笔记（frontmatter），渲染为可点击的卡片网格。
 * 筛选维度对齐小程序「找书」页：书架 / 关键词 / 分类 / 标签 / 在架状态 / 阅读状态 / 排序，
 * 全部在**本地**完成（数据都在笔记 frontmatter 里，不请求后端）。
 */
export class BookshelfView extends ItemView {
	plugin: FindMyBookPlugin;
	private gridEl!: HTMLElement;
	private toolbarEl!: HTMLElement;
	private searchEl!: HTMLInputElement;
	private filterShelfEl!: HTMLSelectElement;
	private filterCategoryEl!: HTMLSelectElement;
	private filterTagEl!: HTMLSelectElement;
	private filterStatusEl!: HTMLSelectElement;
	private filterReadingEl!: HTMLSelectElement;
	private sortEl!: HTMLSelectElement;
	private countEl!: HTMLElement;
	private cards: BookCard[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: FindMyBookPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_FMB_BOOKSHELF;
	}

	getDisplayText(): string {
		return '书放哪了';
	}

	getIcon(): string {
		return 'library';
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('fmb-bookshelf-root');

		// 标题行：滚动时随内容一起滚走。
		// 关键：它必须**和吸顶区并列**、是滚动容器的直接子元素——sticky 元素只在
		// 自己父元素的范围内粘，若标题行当父级，吸顶区就只能在标题那点高度里粘，等于失效。
		const titleWrap = root.createDiv({ cls: 'fmb-toolbar-title' });
		titleWrap.createSpan({ text: '📚 书放哪了', cls: 'fmb-title-text' });
		this.countEl = titleWrap.createSpan({ cls: 'fmb-count' });

		// 吸顶区：搜索 + 筛选（同样是滚动容器的直接子元素）
		this.toolbarEl = root.createDiv({ cls: 'fmb-toolbar' });

		// 第一行：搜索 + 操作
		const actions = this.toolbarEl.createDiv({ cls: 'fmb-toolbar-actions' });

		this.searchEl = actions.createEl('input', {
			cls: 'fmb-search',
			attr: { type: 'search', placeholder: '搜索书名 / 作者 / 位置…' },
		});
		this.searchEl.addEventListener('input', () => this.renderCards());

		const syncBtn = actions.createEl('button', {
			cls: 'fmb-btn fmb-btn-primary',
			text: '同步',
		});
		// 同步会弹出一次性二维码；数据写入完成后 main 会自动刷新本视图
		syncBtn.addEventListener('click', () => {
			void this.plugin.sync();
		});

		const refreshBtn = actions.createEl('button', {
			cls: 'fmb-btn',
			text: '↻',
		});
		refreshBtn.setAttribute('title', '刷新书架');
		refreshBtn.addEventListener('click', () => {
			void this.refresh();
		});

		// 第二行：筛选与排序（书架放最前——它是「书放哪了」最粗的一层组织）
		const filters = this.toolbarEl.createDiv({ cls: 'fmb-toolbar-filters' });
		this.filterShelfEl = this.makeSelect(filters, '书架');
		this.filterShelfEl.addClass('fmb-filter-shelf');
		this.filterCategoryEl = this.makeSelect(filters, '分类');
		this.filterTagEl = this.makeSelect(filters, '书标签');
		this.filterStatusEl = this.makeSelect(filters, '在架状态');
		this.filterReadingEl = this.makeSelect(filters, '阅读状态');
		this.sortEl = this.makeSelect(filters, '排序');

		// 网格容器
		this.gridEl = root.createDiv({ cls: 'fmb-grid' });

		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** 建一个下拉（选项由 populateFilters 填充） */
	private makeSelect(parent: HTMLElement, title: string): HTMLSelectElement {
		const el = parent.createEl('select', { cls: 'fmb-filter' });
		el.setAttribute('title', title);
		el.setAttribute('aria-label', title);
		el.addEventListener('change', () => this.renderCards());
		return el;
	}

	/** 重新读取 vault 中的藏书笔记 */
	async refresh(): Promise<void> {
		this.cards = this.collectBooks();
		this.populateFilters();
		this.renderCards();
	}

	private collectBooks(): BookCard[] {
		const folder = this.plugin.settings.syncFolder.trim();
		const mdFiles = this.app.vault.getMarkdownFiles();
		const cards: BookCard[] = [];

		for (const file of mdFiles) {
			const parentPath = file.parent ? file.parent.path : '';
			// 只取同步目录直属书籍笔记（排除「笔记」子目录与「书架总览」）
			if (parentPath !== folder) continue;
			if (file.name === '书架总览.md') continue;

			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter;
			if (!fm || !isFindMyBookNote(fm)) continue;

			const rawTags: unknown = fm[FM.tagNames];
			const location = s(fm[FM.location]);
			cards.push({
				file,
				title: s(fm[FM.title]) || file.basename,
				author: s(fm[FM.author]),
				publisher: s(fm[FM.publisher]),
				isbn: s(fm[FM.isbn]),
				category: s(fm[FM.category]),
				tags: Array.isArray(rawTags)
					? uniqSorted(rawTags.map((t) => s(t)))
					: [],
				shelf: shelfNameOf(location),
				location,
				status: s(fm[FM.bookStatus]),
				readingStatus: s(fm[FM.readingStatus]),
				clcNumber: s(fm[FM.clcNumber]),
				collectionDate: s(fm[FM.collectionDate]),
				localCover: s(fm[FM.coverFile]),
			});
		}

		return cards;
	}

	/** 填充筛选下拉：书架/分类/标签从库里汇总，在架/阅读状态用固定选项（与小程序一致） */
	private populateFilters(): void {
		// 书架优先用上次同步缓存的书架清单（空书架也能选到，便于确认「这个架上一本都没同步」），
		// 缓存缺失（没同步过）时退回「笔记里解析出的书架」
		const cachedShelves = this.plugin.shelves.map((sh) => sh.name);
		this.fillSelect(
			this.filterShelfEl,
			'全部分架',
			uniqSorted(
				cachedShelves.length > 0
					? [...cachedShelves, ...this.cards.map((c) => c.shelf)]
					: this.cards.map((c) => c.shelf),
			),
		);
		this.fillSelect(
			this.filterCategoryEl,
			'全部分类',
			uniqSorted(this.cards.map((c) => c.category)),
		);
		// 标签优先用后端定义的清单（与小程序「找书」一致：列出全部已定义标签），
		// 老后端没下发时再退回「库里已用到的标签」
		const definedTags = this.plugin.tags ?? [];
		this.fillSelect(
			this.filterTagEl,
			'全部标签',
			uniqSorted(
				definedTags.length > 0
					? definedTags
					: this.cards.flatMap((c) => c.tags),
			),
		);
		this.fillSelect(
			this.filterStatusEl,
			'全部状态',
			Object.values(STATUS_LABELS),
		);
		this.fillSelect(
			this.filterReadingEl,
			'全部阅读状态',
			Object.values(READING_STATUS_LABELS),
		);
		if (this.sortEl.options.length === 0) {
			for (const o of SORT_OPTIONS) {
				this.sortEl.createEl('option', { value: o.value, text: o.label });
			}
		}
	}

	/** 重填选项并尽量保留原选择 */
	private fillSelect(
		el: HTMLSelectElement,
		allLabel: string,
		values: string[],
	): void {
		const prev = el.value;
		el.empty();
		el.createEl('option', { value: '', text: allLabel });
		for (const v of values) el.createEl('option', { value: v, text: v });
		if (values.includes(prev)) el.value = prev;
	}

	private renderCards(): void {
		const q = this.searchEl.value.trim().toLowerCase();
		const shelf = this.filterShelfEl.value;
		const category = this.filterCategoryEl.value;
		const tag = this.filterTagEl.value;
		const status = this.filterStatusEl.value;
		const reading = this.filterReadingEl.value;

		const filtered = this.cards.filter((c) => {
			if (shelf && c.shelf !== shelf) return false;
			if (category && c.category !== category) return false;
			if (tag && !c.tags.includes(tag)) return false;
			if (status && c.status !== status) return false;
			if (reading && c.readingStatus !== reading) return false;
			if (q) {
				const hay =
					`${c.title} ${c.author} ${c.publisher} ${c.isbn} ${c.location} ` +
					`${c.category} ${c.tags.join(' ')}`;
				if (!hay.toLowerCase().includes(q)) return false;
			}
			return true;
		});

		this.sortCards(filtered);

		this.countEl.setText(`共 ${filtered.length} 本`);
		this.gridEl.empty();

		if (filtered.length === 0) {
			this.gridEl.createDiv({
				cls: 'fmb-empty',
				text:
					this.cards.length === 0
						? '暂无藏书。点「同步」从「书放哪了」小程序拉取。'
						: '没有符合当前筛选条件的书。',
			});
			return;
		}

		for (const card of filtered) {
			this.buildCard(card);
		}
	}

	private sortCards(cards: BookCard[]): void {
		const byTitle = (a: BookCard, b: BookCard) =>
			a.title.localeCompare(b.title, 'zh');
		switch (this.sortEl.value as SortKey) {
			case 'author':
				cards.sort(
					(a, b) => a.author.localeCompare(b.author, 'zh') || byTitle(a, b),
				);
				break;
			case 'clc':
				cards.sort(
					(a, b) => a.clcNumber.localeCompare(b.clcNumber, 'zh') || byTitle(a, b),
				);
				break;
			case 'collectionDate':
				// 新→旧；空日期（字符串比较最小）排在最后
				cards.sort((a, b) => b.collectionDate.localeCompare(a.collectionDate));
				break;
			default:
				cards.sort(byTitle);
		}
	}

	private buildCard(card: BookCard): void {
		const el = this.gridEl.createDiv({ cls: 'fmb-card' });

		const coverWrap = el.createDiv({ cls: 'fmb-card-cover' });
		// 本地封面（离线可见）；封面 URL 不再同步到插件，故无远端回退
		const src = card.localCover
			? this.app.vault.adapter.getResourcePath(card.localCover)
			: '';
		if (src) {
			const img = coverWrap.createEl('img', {
				cls: 'fmb-card-img',
				attr: { src, loading: 'lazy', alt: card.title },
			});
			img.addEventListener('error', () => {
				coverWrap.empty();
				coverWrap.createDiv({
					cls: 'fmb-card-cover-placeholder',
					text: card.title.slice(0, 1),
				});
			});
		} else {
			coverWrap.createDiv({
				cls: 'fmb-card-cover-placeholder',
				text: card.title.slice(0, 1),
			});
		}

		if (card.status) {
			const badge = el.createDiv({ cls: 'fmb-card-badge' });
			badge.setText(card.status);
			badge.setAttribute('data-status', card.status);
			badge.setAttribute('title', '在架状态');
		}
		if (card.readingStatus) {
			const badge = el.createDiv({
				cls: 'fmb-card-badge fmb-card-badge-reading',
			});
			badge.setText(card.readingStatus);
			badge.setAttribute('title', '阅读状态');
		}

		const body = el.createDiv({ cls: 'fmb-card-body' });
		body.createDiv({ cls: 'fmb-card-title', text: card.title });
		if (card.author) body.createDiv({ cls: 'fmb-card-author', text: card.author });
		if (card.location)
			body.createDiv({ cls: 'fmb-card-location', text: '📍 ' + card.location });

		// 左键：进入书籍详情页（右击仍可直接打开原始笔记）
		el.addEventListener('click', () => {
			void this.plugin.openBookDetail(card.file);
		});

		// 右键菜单：快速操作
		el.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item.setTitle('打开详情页').setIcon('book-open').onClick(() => {
					void this.plugin.openBookDetail(card.file);
				}),
			);
			menu.addItem((item) =>
				item.setTitle('打开笔记').setIcon('file-text').onClick(() => {
					void this.app.workspace.getLeaf(false).openFile(card.file);
				}),
			);
			menu.showAtMouseEvent(e);
		});
	}
}
