import {
	ItemView,
	Notice,
	Setting,
	TFile,
	ViewStateResult,
	WorkspaceLeaf,
} from 'obsidian';
import type FindMyBookPlugin from '../main';
import {
	FM,
	CHANNEL_LABELS,
	CONDITION_LABELS,
	STATUS_LABELS,
	READING_STATUS_LABELS,
	isFindMyBookNote,
} from '../noteMeta';
import { PositionPickerModal } from './PositionPickerModal';

export const VIEW_TYPE_FMB_BOOK_DETAIL = 'fmb-book-detail-view';

export interface BookDetailState {
	path: string;
}

function s(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return '';
}

function strList(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	const out: string[] = [];
	for (const item of v as unknown[]) {
		if (typeof item === 'string' && item !== '') out.push(item);
	}
	return out;
}

function extractIntro(content: string | null | undefined): string {
	if (!content) return '';
	const lines = content.split(/\r?\n/);
	let capture = false;
	const out: string[] = [];
	for (const line of lines) {
		if (/^##\s+简介\s*$/.test(line)) {
			capture = true;
			continue;
		}
		if (capture) {
			if (/^(```|##\s+|>\s?)/.test(line)) break;
			out.push(line);
		}
	}
	return out.join('\n').trim();
}

export class BookDetailView extends ItemView {
	plugin: FindMyBookPlugin;
	private filePath = '';
	private locationWrap?: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: FindMyBookPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_FMB_BOOK_DETAIL;
	}

	getDisplayText(): string {
		return '书籍详情';
	}

	getIcon(): string {
		return 'book-open';
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		this.filePath = (state as BookDetailState | null)?.path ?? '';
		await super.setState(state, result);
		await this.render();
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('fmb-detail-root');

		const file = this.filePath
			? this.app.vault.getAbstractFileByPath(this.filePath)
			: null;
		if (!(file instanceof TFile)) {
			root.createDiv({
				cls: 'fmb-detail-empty',
				text: '未选择书籍。回到「书放哪了」书架，点一本书进来。',
			});
			return;
		}

		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm || !isFindMyBookNote(fm)) {
			root.createDiv({
				cls: 'fmb-detail-empty',
				text: '这张笔记不是插件的藏书笔记。',
			});
			return;
		}

		const title = s(fm[FM.title]) || file.basename;
		this.buildHeader(root, file, title, fm);
		this.buildReadonly(root, fm);
		await this.buildIntro(root, file);
		this.buildEditable(root, file, fm);

		new Setting(root)
			.addButton((btn) =>
				btn.setButtonText('打开笔记').onClick(() => {
					void this.app.workspace.getLeaf(false).openFile(file);
				}),
			)
			.addButton((btn) =>
				btn.setButtonText('刷新').onClick(() => {
					void this.render();
				}),
			);
	}

	private buildHeader(
		root: HTMLElement,
		file: TFile,
		title: string,
		fm: Record<string, unknown>,
	): void {
		const header = root.createDiv({ cls: 'fmb-detail-header' });

		const coverWrap = header.createDiv({ cls: 'fmb-detail-cover' });
		const coverPath = s(fm[FM.coverFile]);
		if (coverPath && this.app.vault.getAbstractFileByPath(coverPath)) {
			coverWrap.createEl('img', {
				cls: 'fmb-detail-cover-img',
				attr: {
					src: this.app.vault.adapter.getResourcePath(coverPath),
					alt: title,
				},
			});
		} else {
			coverWrap.createDiv({
				cls: 'fmb-detail-cover-placeholder',
				text: title.slice(0, 1),
			});
		}

		const info = header.createDiv({ cls: 'fmb-detail-info' });
		info.createDiv({ cls: 'fmb-detail-title', text: title });
		const sub = [s(fm[FM.author]), s(fm[FM.publisher])].filter(Boolean);
		if (sub.length > 0) {
			info.createDiv({ cls: 'fmb-detail-sub', text: sub.join(' · ') });
		}
		info.createDiv({
			cls: 'fmb-detail-file',
			text: file.basename,
		});
	}

	private buildReadonly(root: HTMLElement, fm: Record<string, unknown>): void {
		const section = root.createDiv({ cls: 'fmb-detail-section' });
		section.createEl('h4', { cls: 'fmb-detail-h4', text: '书籍信息（只读）' });

		const listPrice = s(fm[FM.listPrice]);
		const listPriceOriginal = s(fm[FM.listPriceOriginal]);
		const listPriceRate = s(fm[FM.listPriceRate]);
		const listPriceValue = listPrice ? `¥${listPrice}` : listPriceOriginal;
		const listPriceNote = listPrice
			? [
					listPriceOriginal ? `原价 ${listPriceOriginal}` : '',
					listPriceRate ? `汇率 ${listPriceRate}` : '',
				]
					.filter(Boolean)
					.join(' · ')
			: listPriceOriginal
				? '外币定价，暂无可用汇率，未折算'
				: '';

		const items: Array<[string, string, string?]> = [
			['分类', s(fm[FM.category])],
			['中图分类号', s(fm[FM.clcNumber])],
			['ISBN', s(fm[FM.isbn])],
			['版次', s(fm[FM.edition])],
			['印次', s(fm[FM.printing])],
			['字数', s(fm[FM.wordCount])],
			['装帧', s(fm[FM.binding])],
			['纸质', s(fm[FM.paperType])],
			['定价', listPriceValue, listPriceNote],
		];
		const list = section.createEl('ul', { cls: 'fmb-detail-list' });
		let any = false;
		for (const [label, value, note] of items) {
			if (!value) continue;
			any = true;
			const row = list.createEl('li', { cls: 'fmb-detail-row' });
			row.createSpan({ cls: 'fmb-detail-row-label', text: label });
			const valueEl = row.createSpan({ cls: 'fmb-detail-row-value', text: value });
			if (note) valueEl.createSpan({ cls: 'fmb-detail-row-note', text: note });
		}
		if (!any) {
			section.createDiv({ cls: 'fmb-detail-empty', text: '（暂无）' });
		}

		this.locationWrap = section.createDiv({ cls: 'fmb-detail-row' });
		this.renderLocation(this.locationWrap, s(fm[FM.location]));
	}

	private async buildIntro(root: HTMLElement, file: TFile): Promise<void> {
		const section = root.createDiv({ cls: 'fmb-detail-section' });
		section.createEl('h4', { cls: 'fmb-detail-h4', text: '简介' });

		const intro = extractIntro(await this.app.vault.cachedRead(file));
		if (!intro) {
			section.createDiv({ cls: 'fmb-detail-empty', text: '（暂无）' });
			return;
		}
		section.createDiv({ cls: 'fmb-detail-intro', text: intro });
	}

	private buildEditable(
		root: HTMLElement,
		file: TFile,
		fm: Record<string, unknown>,
	): void {
		const section = root.createDiv({ cls: 'fmb-detail-section' });
		section.createEl('h4', {
			cls: 'fmb-detail-h4',
			text: '藏书信息（可改，改完用「反向同步」传回小程序）',
		});

		new Setting(section).setName('藏书状态').addDropdown((dd) => {
			dd.addOption('', '（未设置）');
			for (const v of Object.values(STATUS_LABELS)) dd.addOption(v, v);
			dd.setValue(s(fm[FM.bookStatus]));
			dd.onChange((v) => void this.write(file, FM.bookStatus, v));
		});

		new Setting(section)
			.setName('阅读状态')
			.addDropdown((dd) => {
				for (const v of Object.values(READING_STATUS_LABELS)) dd.addOption(v, v);
				const cur = s(fm[FM.readingStatus]);
				dd.setValue(cur);
				for (const opt of Array.from(dd.selectEl.options)) {
					if (opt.value === READING_STATUS_LABELS.NOT_STARTED) opt.disabled = true;
				}
				dd.onChange((v) => void this.write(file, FM.readingStatus, v));
			});

		new Setting(section).setName('书况').addDropdown((dd) => {
			dd.addOption('', '（未设置）');
			for (const v of Object.values(CONDITION_LABELS)) dd.addOption(v, v);
			dd.setValue(s(fm[FM.bookCondition]));
			dd.onChange((v) => void this.write(file, FM.bookCondition, v));
		});

		new Setting(section)
			.setName('获取渠道')
			.setDesc('与他人赠送 / 借入 / 各购买渠道之一')
			.addDropdown((dd) => {
				dd.addOption('', '（未设置）');
				for (const v of Object.values(CHANNEL_LABELS)) dd.addOption(v, v);
				dd.setValue(s(fm[FM.acquisitionChannel]));
				dd.onChange((v) => void this.write(file, FM.acquisitionChannel, v));
			});

		new Setting(section)
			.setName('购入日期')
			.addText((t) => {
				t.inputEl.type = 'date';
				t.setValue(s(fm[FM.collectionDate]));
				t.inputEl.addEventListener('change', () => {
					void this.write(file, FM.collectionDate, t.getValue());
				});
			});

		new Setting(section)
			.setName('购入价格')
			.setDesc('单位：元')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.inputEl.step = '0.01';
				t.setValue(s(fm[FM.purchasePrice]));
				t.inputEl.addEventListener('blur', () => {
					void this.write(file, FM.purchasePrice, t.getValue());
				});
			});

		new Setting(section).setName('备注').addTextArea((t) => {
			t.setValue(s(fm[FM.remark]));
			t.inputEl.addEventListener('blur', () => {
				void this.write(file, FM.remark, t.getValue());
			});
		});

		const tagSetting = new Setting(section).setName('自定义标签').setDesc(
			'点选切换（可多选）。标签在小程序「标签管理」里增删，同步后这里就能选到；' +
				'后端写入时也会校验「标签必须已存在」，所以不接受手填。',
		);
		this.buildTagEditor(tagSetting.settingEl, file, strList(fm[FM.tagNames]));

		new Setting(section)
			.setName('摆放位置')
			.setDesc('后端改位置只认书架/层格/序号三个 ID，用点选而非手填')
			.addButton((btn) =>
				btn.setButtonText('选择…').onClick(() => {
					const modal = new PositionPickerModal(this.app, this.plugin, file);
					modal.onSaved = (loc) => {
						if (this.locationWrap) this.renderLocation(this.locationWrap, loc);
					};
					modal.open();
				}),
			);
	}

	private buildTagEditor(
		container: HTMLElement,
		file: TFile,
		current: string[],
	): void {
		const wrap = container.createDiv({ cls: 'fmb-tag-editor' });
		this.renderTagEditor(wrap, file, current);
	}

	private renderTagEditor(wrap: HTMLElement, file: TFile, current: string[]): void {
		wrap.empty();
		const defined = this.plugin.tags ?? [];
		if (defined.length === 0) {
			wrap.createDiv({
				cls: 'fmb-tag-empty',
				text: '还没有自定义标签。在小程序里创建后同步一次即可。',
			});
			return;
		}
		for (const tag of defined) {
			const selected = current.includes(tag);
			const chip = wrap.createDiv({
				cls: `fmb-tag fmb-tag-option${selected ? ' is-selected' : ''}`,
				text: tag,
			});
			chip.setAttribute('title', selected ? '点击取消' : '点击选用');
			chip.addEventListener('click', () => {
				const next = selected
					? current.filter((t) => t !== tag)
					: [...current, tag];
				void this.write(file, FM.tagNames, next).then(() =>
					this.renderTagEditor(wrap, file, next),
				);
			});
		}
		for (const tag of current.filter((t) => !defined.includes(t))) {
			const chip = wrap.createDiv({ cls: 'fmb-tag fmb-tag-unknown' });
			chip.createSpan({ text: tag });
			const remove = chip.createSpan({ cls: 'fmb-tag-remove', text: '×' });
			remove.setAttribute('title', '未定义的标签，移除');
			remove.addEventListener('click', () => {
				void this.write(file, FM.tagNames, current.filter((t) => t !== tag)).then(
					() => this.renderTagEditor(wrap, file, current.filter((t) => t !== tag)),
				);
			});
		}
	}

	private renderLocation(wrap: HTMLElement, loc: string): void {
		wrap.empty();
		wrap.createSpan({ cls: 'fmb-detail-row-label', text: '摆放位置' });
		wrap.createSpan({
			cls: 'fmb-detail-row-value',
			text: loc || '—',
		});
	}

	private async write(
		file: TFile,
		key: string,
		value: string | string[],
	): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					fm[key] = value;
				},
			);
			this.plugin.refreshBookshelfViews();
		} catch (e) {
			new Notice('写入失败：' + (e instanceof Error ? e.message : String(e)));
		}
	}
}
