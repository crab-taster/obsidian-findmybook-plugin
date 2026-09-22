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

function s(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return '';
}

function uniqSorted(values: string[]): string[] {
	return Array.from(new Set(values.filter((v) => v !== ''))).sort((a, b) =>
		a.localeCompare(b, 'zh'),
	);
}

type SortKey = 'title' | 'author' | 'clc' | 'collectionDate';

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
	shelf: string;
	location: string;
	status: string;
	readingStatus: string;
	clcNumber: string;
	collectionDate: string;
	localCover: string;
}

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

		const titleWrap = root.createDiv({ cls: 'fmb-toolbar-title' });
		titleWrap.createSpan({ text: '📚 书放哪了', cls: 'fmb-title-text' });
		this.countEl = titleWrap.createSpan({ cls: 'fmb-count' });

		this.toolbarEl = root.createDiv({ cls: 'fmb-toolbar' });

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

		const filters = this.toolbarEl.createDiv({ cls: 'fmb-toolbar-filters' });
		this.filterShelfEl = this.makeSelect(filters, '书架');
		this.filterShelfEl.addClass('fmb-filter-shelf');
		this.filterCategoryEl = this.makeSelect(filters, '分类');
		this.filterTagEl = this.makeSelect(filters, '书标签');
		this.filterStatusEl = this.makeSelect(filters, '在架状态');
		this.filterReadingEl = this.makeSelect(filters, '阅读状态');
		this.sortEl = this.makeSelect(filters, '排序');

		this.gridEl = root.createDiv({ cls: 'fmb-grid' });

		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private makeSelect(parent: HTMLElement, title: string): HTMLSelectElement {
		const el = parent.createEl('select', { cls: 'fmb-filter' });
		el.setAttribute('title', title);
		el.setAttribute('aria-label', title);
		el.addEventListener('change', () => this.renderCards());
		return el;
	}

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

	private populateFilters(): void {
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
				cards.sort((a, b) => b.collectionDate.localeCompare(a.collectionDate));
				break;
			default:
				cards.sort(byTitle);
		}
	}

	private buildCard(card: BookCard): void {
		const el = this.gridEl.createDiv({ cls: 'fmb-card' });

		const coverWrap = el.createDiv({ cls: 'fmb-card-cover' });
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

		el.addEventListener('click', () => {
			void this.plugin.openBookDetail(card.file);
		});

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
