import { Notice, TFile } from 'obsidian';
import type FindMyBookPlugin from './main';
import {
	SortedBook,
	ReadingPlan,
	ReadingNote,
	BookshelfListResponse,
	BookshelfDetailResponse,
	SyncPayload,
	CoverBytes,
} from './types';
import {
	FM,
	SOURCE_MARKER,
	STATUS_LABELS,
	CONDITION_LABELS,
	CHANNEL_LABELS,
	READING_STATUS_LABELS,
	BINDING_LABELS,
	PAPER_TYPE_LABELS,
	payloadBlockLines,
	toLabel,
} from './noteMeta';

/** 控制字符（含换行 / 制表）一律换成空格——文件名里不能出现它们 */
function stripControlChars(s: string): string {
	let out = '';
	for (const ch of s) {
		const code = ch.codePointAt(0) ?? 0;
		out += code < 0x20 || code === 0x7f ? ' ' : ch;
	}
	return out;
}

/** 文件名非法字符清洗（Obsidian/vault 不允许 \ / : * ? " < > | # ^ [ ]） */
function sanitize(name: string): string {
	return stripControlChars(name)
		.replace(/[\\/:*?"<>|#^[\]]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100);
}

/** 取多行文本的第一行非空内容（后端的中图分类号可能是多行） */
function firstLine(v: string | undefined): string {
	if (!v) return '';
	for (const line of v.split(/\r?\n/)) {
		const t = line.trim();
		if (t !== '') return t;
	}
	return '';
}

/** YAML 标量：空值写 ''，字符串加引号，数字/布尔原样 */
function yamlScalar(v: unknown): string {
	if (v === null || v === undefined || v === '') return "''";
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	if (typeof v === 'string') return JSON.stringify(v);
	return JSON.stringify(v);
}

/** 价格展示串：优先原币原始串（如 "US$20.00"），否则人民币分转元 */
function priceString(book: SortedBook): string {
	if (book.purchasePriceRaw) return book.purchasePriceRaw;
	if (book.purchasePrice != null) return (book.purchasePrice / 100).toFixed(2);
	return '';
}

/**
 * 定价的三件套（只读元数据，与「购入价」不同源：定价在 UnifiedBook 上、原币种入库）。
 * - `price`：人民币折算数字串（如 "143.88"）；后端无可用汇率时为 null —— 宁可不显示也不写错数
 * - `original`：原币展示串（如 "US$21.41"）；纯人民币定价给空串，避免同一笔钱写两遍
 * - `rate`：折算所用汇率（如 "6.72"），同上只有外币定价才有
 */
function listPriceOf(book: SortedBook): { price: string; original: string; rate: string } {
	const info = book.priceInfo ?? null;
	const currency = info?.currency ?? '';
	const foreign = currency !== '' && currency !== 'CNY';
	return {
		price: book.price ?? '',
		original: foreign ? (info?.display ?? '') : '',
		rate: foreign ? (info?.rate ?? '') : '',
	};
}

/** 藏书信息快照：既写进 frontmatter，也作为反向同步的基线（用于 diff 出改动） */
export interface CollectionSnapshot {
	location: string;
	collectionDate: string;
	bookCondition: string;
	acquisitionChannel: string;
	purchasePrice: string;
	remark: string;
	tagNames: string[];
	bookStatus: string;
	readingStatus: string;
	bookshelfId: number | '';
	gridId: number | '';
	bookIndexInGrid: number | '';
}

/** 由后端书籍构造藏书信息快照 */
export function collectionOf(book: SortedBook): CollectionSnapshot {
	return {
		location: book.location ?? '',
		collectionDate: book.collectionDate ?? '',
		bookCondition: book.bookCondition ?? '',
		acquisitionChannel: book.acquisitionChannel ?? '',
		purchasePrice: priceString(book),
		remark: book.remark ?? '',
		tagNames: book.tagNames
			? book.tagNames
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: [],
		bookStatus: book.bookStatus ?? '',
		readingStatus: book.readingStatus ?? '',
		bookshelfId: book.bookshelfId ?? '',
		gridId: book.bookGridId ?? '',
		bookIndexInGrid: book.bookIndexInGrid ?? '',
	};
}

/**
 * 生成单本书的 markdown 内容。
 * frontmatter 全为顶层属性：元数据（只读，正向同步时由服务器覆盖）+ 藏书信息（可改，可反向同步）。
 */
function bookNoteContent(book: SortedBook, coverFile: string): string {
	const c = collectionOf(book);
	const clc = firstLine(book.clcNumber); // 多行只保留第一行
	const fm: string[] = ['---'];
	fm.push(`${FM.source}: ${SOURCE_MARKER}`);
	fm.push(`${FM.syncedAt}: ${new Date().toISOString()}`);
	// 书籍元数据（只读：正向同步时由服务器覆盖）
	fm.push(`${FM.title}: ${JSON.stringify(book.title)}`);
	fm.push(`${FM.author}: ${yamlScalar(book.author)}`);
	fm.push(`${FM.publisher}: ${yamlScalar(book.publisher)}`);
	fm.push(`${FM.isbn}: ${yamlScalar(book.isbn)}`);
	fm.push(`${FM.category}: ${yamlScalar(book.category)}`);
	fm.push(`${FM.clcNumber}: ${yamlScalar(clc)}`);
	fm.push(`${FM.edition}: ${yamlScalar(book.edition)}`);
	fm.push(`${FM.printing}: ${yamlScalar(book.printing)}`);
	fm.push(`${FM.wordCount}: ${yamlScalar(book.wordCount)}`);
	// 装帧 / 纸质（只读元数据）：正文里一直有写，但详情页的属性清单读的是 frontmatter，
	// 只有正文那一份时那两行永远显示不出来，所以补进 frontmatter
	const binding = toLabel(BINDING_LABELS, book.binding ?? '');
	if (binding) fm.push(`${FM.binding}: ${yamlScalar(binding)}`);
	const paper = toLabel(PAPER_TYPE_LABELS, book.paperType ?? '');
	if (paper) fm.push(`${FM.paperType}: ${yamlScalar(paper)}`);
	// 定价（只读元数据）：主值 = 人民币折算数字串，外币定价另存原币展示串与所用汇率
	const lp = listPriceOf(book);
	fm.push(`${FM.listPrice}: ${yamlScalar(lp.price)}`);
	if (lp.original) fm.push(`${FM.listPriceOriginal}: ${yamlScalar(lp.original)}`);
	if (lp.rate) fm.push(`${FM.listPriceRate}: ${yamlScalar(lp.rate)}`);
	if (coverFile) fm.push(`${FM.coverFile}: ${JSON.stringify(coverFile)}`);
	// 藏书信息（可改：属性面板直接编辑后用「反向同步」传回）
	fm.push(`${FM.location}: ${yamlScalar(c.location)}`);
	fm.push(`${FM.collectionDate}: ${yamlScalar(c.collectionDate)}`);
	fm.push(`${FM.bookCondition}: ${yamlScalar(toLabel(CONDITION_LABELS, c.bookCondition))}`);
	fm.push(
		`${FM.acquisitionChannel}: ${yamlScalar(toLabel(CHANNEL_LABELS, c.acquisitionChannel))}`,
	);
	fm.push(`${FM.purchasePrice}: ${yamlScalar(c.purchasePrice)}`);
	fm.push(`${FM.remark}: ${yamlScalar(c.remark)}`);
	fm.push(`${FM.tagNames}: [${c.tagNames.join(', ')}]`);
	fm.push(`${FM.bookStatus}: ${yamlScalar(toLabel(STATUS_LABELS, c.bookStatus))}`);
	fm.push(
		`${FM.readingStatus}: ${yamlScalar(toLabel(READING_STATUS_LABELS, book.readingStatus ?? ''))}`,
	);
	fm.push('---');
	fm.push('');

	const body: string[] = [];
	if (coverFile) {
		body.push(`![[${coverFile}]]`, '');
	}
	body.push(`# ${book.title}`);
	if (book.author) body.push(`**作者**：${book.author}`);
	if (book.publisher) body.push(`**出版社**：${book.publisher}`);
	if (book.edition) body.push(`**版次**：${book.edition}`);
	if (book.printing) body.push(`**印次**：${book.printing}`);
	if (book.wordCount) body.push(`**字数**：${book.wordCount}`);
	if (book.binding) body.push(`**装帧**：${toLabel(BINDING_LABELS, book.binding)}`);
	if (book.paperType) body.push(`**纸质**：${toLabel(PAPER_TYPE_LABELS, book.paperType)}`);
	// 定价（只读元数据）：人民币折算值为主，外币定价值顺手把书上印的原价带上
	if (lp.price || lp.original) {
		const main = lp.price ? `¥${lp.price}` : lp.original;
		const origin = lp.price && lp.original ? `（原价 ${lp.original}）` : '';
		body.push(`**定价**：${main}${origin}`);
	}
	if (book.location) body.push(`**位置**：${book.location}`);
	if (book.bookStatus) body.push(`**藏书状态**：${toLabel(STATUS_LABELS, book.bookStatus)}`);
	const readingStatus = toLabel(READING_STATUS_LABELS, book.readingStatus ?? '');
	if (readingStatus) body.push(`**阅读状态**：${readingStatus}`);
	if (clc) body.push(`**中图分类号**：${clc}`);
	// 书籍简介（只读元数据，最长约 1000 字）：独立 ## 段落，正文展示 + 详情页读取
	if (book.intro) body.push('', '## 简介', book.intro.trim());
	// 只读/可改的划分不再写进笔记正文：在属性面板和「书籍详情页」里已经一目了然
	body.push(
		'',
		`> 可选值：\`${FM.bookCondition}\` = ${Object.values(CONDITION_LABELS).join(' / ')}；` +
			`\`${FM.bookStatus}\` = ${Object.values(STATUS_LABELS).join(' / ')}；` +
			`\`${FM.acquisitionChannel}\` = ${Object.values(CHANNEL_LABELS).join(' / ')}。`,
	);
	// 机器字段（书籍ID + 位置三个 ID）藏在代码块里，不进属性面板
	body.push(
		'',
		...payloadBlockLines({
			bookId: book.myBookId,
			bookshelfId: c.bookshelfId,
			gridId: c.gridId,
			bookIndexInGrid: c.bookIndexInGrid,
		}),
	);

	return fm.concat(body).join('\n');
}

/** 笔记合集内容（阅读计划 + 读书笔记），无内容时返回 null */
function noteCollectionContent(
	title: string,
	plans: ReadingPlan[],
	notes: ReadingNote[],
): string | null {
	const hasContent = plans.length > 0 || notes.length > 0;
	if (!hasContent) return null;

	const fm: string[] = ['---'];
	fm.push(`${FM.title}: ${JSON.stringify(title)}`);
	fm.push(`${FM.source}: ${SOURCE_MARKER}`);
	fm.push(`${FM.syncedAt}: ${new Date().toISOString()}`);
	fm.push('---');
	fm.push('');

	const body: string[] = [];
	body.push(`# ${title} · 阅读计划与笔记`);

	// 阅读计划
	body.push('', '## 阅读计划');
	if (plans.length === 0) {
		body.push('（暂无阅读计划）');
	} else {
		for (const p of plans) {
			body.push(
				`- 计划 #${p.id}：${p.status}｜共 ${p.totalPages} 页，从第 ${p.startPage} 页起，每日 ${p.dailyPages} 页，始于 ${p.startDate}（待读 ${p.pagesToRead} 页）`,
			);
		}
	}

	// 读书笔记
	body.push('', '## 读书笔记');
	if (notes.length === 0) {
		body.push('（暂无笔记）');
	} else {
		// 按创建时间升序，最早的在前
		const sorted = [...notes].sort((a, b) =>
			(a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
		);
		for (const n of sorted) {
			const pageLabel = n.page != null ? `第 ${n.page} 页` : '未标注页';
			body.push('', `### ${pageLabel} · ${n.createdAt ?? ''}`.trim());
			body.push(n.content?.trim() || '（无文字内容）');
			if (n.imageUrl) body.push(`![](${n.imageUrl})`);
		}
	}

	return fm.concat(body).join('\n');
}

/** 书架总览内容（书架 → 层 → 格） */
function bookshelfOverviewContent(
	list: BookshelfListResponse,
	details: BookshelfDetailResponse[],
): string {
	const fm: string[] = ['---'];
	fm.push(`${FM.source}: ${SOURCE_MARKER}`);
	fm.push(`${FM.syncedAt}: ${new Date().toISOString()}`);
	fm.push('---');
	fm.push('');

	const body: string[] = [];
	body.push(`# 书架总览`);
	body.push('');
	body.push(`共 ${list.total ?? 0} 个书架。`);

	for (const d of details) {
		body.push('', `## ${d.name}${d.isDefault ? '（默认）' : ''}`);
		body.push(
			`${d.layerCount ?? '?'} 层 / ${d.gridCount ?? '?'} 格，共 ${d.totalBooks} 本有效藏书。`,
		);
		if (d.grids && d.grids.length > 0) {
			for (const g of d.grids) {
				body.push(`- ${g.gridPosition}：${g.bookCount} 本`);
			}
		}
	}

	return fm.concat(body).join('\n');
}

/** 写入/更新单个笔记文件，返回 'created' | 'updated' | 'skipped' */
async function writeNote(
	vault: FindMyBookPlugin['app']['vault'],
	path: string,
	content: string,
): Promise<'created' | 'updated' | 'skipped'> {
	const existing = vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		const old = await vault.read(existing);
		if (old !== content) {
			await vault.modify(existing, content);
			return 'updated';
		}
		return 'skipped';
	}
	await vault.create(path, content);
	return 'created';
}

async function ensureFolder(
	vault: FindMyBookPlugin['app']['vault'],
	folder: string,
): Promise<void> {
	if (folder && !vault.getAbstractFileByPath(folder)) {
		try {
			await vault.createFolder(folder);
		} catch {
			/* 并发或已存在，忽略 */
		}
	}
}

interface WriteStat {
	created: number;
	updated: number;
	skipped: number;
}

function record(stat: WriteStat, r: 'created' | 'updated' | 'skipped'): void {
	if (r === 'created') stat.created++;
	else if (r === 'updated') stat.updated++;
	else stat.skipped++;
}

/** 文件名前缀：中图分类号取第一行（缺失时用「未分类」占位）。标题里不放书籍ID */
function clcPrefix(book: SortedBook): string {
	return firstLine(book.clcNumber) || '未分类';
}

/** 文件名占位键：NFC + 小写（macOS 文件系统大小写不敏感，仅大小写不同的名字会互相覆盖） */
function nameSlot(fileName: string): string {
	return fileName.normalize('NFC').toLowerCase();
}

/** 生成笔记文件名；同批内重名（同分类号 + 同书名）时补书籍ID消歧 */
function noteFileName(
	used: Map<string, string>,
	key: string,
	prefix: string,
	title: string,
): string {
	const base = sanitize(`${prefix} - ${title}`);
	let file = base + '.md';
	let slot = nameSlot(file);
	const owner = used.get(slot);
	if (owner !== undefined && owner !== key) {
		file = sanitize(`${prefix} - ${title} (${key})`) + '.md';
		slot = nameSlot(file);
	}
	used.set(slot, key);
	return file;
}

/**
 * 旧命名（`<书籍ID> - <书名>.md`）迁移到新命名。
 * 新路径不存在而旧路径在时直接改名，用户在这张笔记里的改动就保住了。
 */
async function migrateLegacyNote(
	plugin: FindMyBookPlugin,
	legacyPath: string,
	newPath: string,
): Promise<void> {
	if (legacyPath === newPath) return;
	const vault = plugin.app.vault;
	if (vault.getAbstractFileByPath(newPath)) return;
	const old = vault.getAbstractFileByPath(legacyPath);
	if (!(old instanceof TFile)) return;
	try {
		await plugin.app.fileManager.renameFile(old, newPath);
	} catch {
		/* 改名失败就按新文件创建，旧文件留给用户自行处理 */
	}
}

/**
 * 写入藏书笔记：每本 `<中图分类号> - <书名>.md`，增量（不存在则建、内容变化才更新）。
 * `coverFailed` 统计「后端说有封面、但字节没取到」的书数（权限/文件缺失/外链失败）——
 * 以前这类失败是完全静默的，只能靠翻代码定位。
 */
async function writeBooks(
	plugin: FindMyBookPlugin,
	books: SortedBook[],
	downloadCover?: CoverDownloader,
): Promise<WriteStat & { coverFailed: number }> {
	const folder = plugin.settings.syncFolder.trim();
	const vault = plugin.app.vault;
	await ensureFolders(vault, folder);
	const coverDir = folder ? `${folder}/附件/封面` : '附件/封面';
	if (downloadCover) await ensureFolders(vault, coverDir);

	const stat: WriteStat & { coverFailed: number } = {
		created: 0,
		updated: 0,
		skipped: 0,
		coverFailed: 0,
	};
	const used = new Map<string, string>();
	for (const book of books) {
		const fileName = noteFileName(
			used,
			String(book.myBookId),
			clcPrefix(book),
			book.title,
		);
		const path = folder ? `${folder}/${fileName}` : fileName;
		const legacyName = sanitize(`${book.myBookId} - ${book.title}`) + '.md';
		await migrateLegacyNote(
			plugin,
			folder ? `${folder}/${legacyName}` : legacyName,
			path,
		);

		// 本地封面已存在则复用；否则若有封面就通过会话取字节（插件端不接触封面 URL）
		const prevCoverFile = readPrevCoverFile(plugin, path);
		let coverFile = '';
		if (prevCoverFile && vault.getAbstractFileByPath(prevCoverFile)) {
			coverFile = prevCoverFile;
		} else if (downloadCover && book.hasCover) {
			const got = await downloadCover(book);
			if (got && got.bytes.byteLength > 0) {
				const cpath = `${coverDir}/${book.myBookId}.${got.ext}`;
				try {
					const existing = vault.getAbstractFileByPath(cpath);
					if (existing instanceof TFile) await vault.modifyBinary(existing, got.bytes);
					else await vault.createBinary(cpath, got.bytes);
					coverFile = cpath;
				} catch {
					/* 写入失败则不引用封面 */
					stat.coverFailed++;
				}
			} else {
				// 后端说这本书有封面，但字节没取到（权限不足 / 文件缺失 / 外链抓取失败）
				stat.coverFailed++;
			}
		}
		record(stat, await writeNote(vault, path, bookNoteContent(book, coverFile)));
	}
	return stat;
}

/** 封面下载器：由调用方注入（走会话封面端点），返回字节 + 扩展名 */
export type CoverDownloader = (book: SortedBook) => Promise<CoverBytes | null>;

/** 读取已存在笔记的 `封面`（用于复用本地封面，避免重复下载） */
function readPrevCoverFile(plugin: FindMyBookPlugin, path: string): string {
	const f = plugin.app.vault.getAbstractFileByPath(path);
	if (!(f instanceof TFile)) return '';
	const fm: Record<string, unknown> | undefined =
		plugin.app.metadataCache.getFileCache(f)?.frontmatter;
	const v = fm?.[FM.coverFile];
	return typeof v === 'string' ? v : '';
}

/** 逐级创建文件夹（支持 a/b/c） */
async function ensureFolders(
	vault: FindMyBookPlugin['app']['vault'],
	dir: string,
): Promise<void> {
	if (!dir) return;
	const parts = dir.split('/');
	let cur = '';
	for (const p of parts) {
		cur = cur ? `${cur}/${p}` : p;
		if (!vault.getAbstractFileByPath(cur)) {
			try {
				await vault.createFolder(cur);
			} catch {
				/* 已存在 / 并发，忽略 */
			}
		}
	}
}

/**
 * 写入笔记合集：每本有阅读数据的书聚合到 <同步目录>/笔记/<中图分类号> - <书名>.md。
 */
async function writePlansAndNotes(
	plugin: FindMyBookPlugin,
	books: SortedBook[],
	plans: ReadingPlan[],
	notes: ReadingNote[],
): Promise<WriteStat & { empty: number }> {
	const titleById = new Map<number, string>();
	const clcById = new Map<number, string>();
	for (const b of books) {
		titleById.set(b.myBookId, b.title);
		clcById.set(b.myBookId, clcPrefix(b));
	}

	const plansByBook = new Map<number, ReadingPlan[]>();
	const notesByBook = new Map<number, ReadingNote[]>();
	for (const p of plans) {
		const arr = plansByBook.get(p.myBookId) ?? [];
		arr.push(p);
		plansByBook.set(p.myBookId, arr);
	}
	for (const n of notes) {
		const arr = notesByBook.get(n.myBookId) ?? [];
		arr.push(n);
		notesByBook.set(n.myBookId, arr);
	}

	const folder = plugin.settings.syncFolder.trim();
	const notesFolder = folder ? `${folder}/笔记` : '笔记';
	const vault = plugin.app.vault;
	await ensureFolder(vault, notesFolder);

	const stat: WriteStat & { empty: number } = { created: 0, updated: 0, skipped: 0, empty: 0 };
	const used = new Map<string, string>();
	for (const [myBookId, title] of titleById) {
		const p = plansByBook.get(myBookId) ?? [];
		const n = notesByBook.get(myBookId) ?? [];
		const content = noteCollectionContent(title, p, n);
		if (content === null) {
			stat.empty++;
			continue; // 该书无计划无笔记，不生成笔记文件
		}
		const fileName = noteFileName(
			used,
			String(myBookId),
			clcById.get(myBookId) ?? '未分类',
			title,
		);
		const path = `${notesFolder}/${fileName}`;
		await migrateLegacyNote(
			plugin,
			`${notesFolder}/${sanitize(`${myBookId} - ${title}`)}.md`,
			path,
		);
		record(stat, await writeNote(vault, path, content));
	}
	return stat;
}

/** 写入书架总览索引笔记 */
async function writeBookshelfOverview(
	plugin: FindMyBookPlugin,
	list: BookshelfListResponse,
	details: BookshelfDetailResponse[],
): Promise<WriteStat> {
	const folder = plugin.settings.syncFolder.trim();
	const vault = plugin.app.vault;
	await ensureFolder(vault, folder);

	const path = folder ? `${folder}/书架总览.md` : '书架总览.md';
	const stat: WriteStat = { created: 0, updated: 0, skipped: 0 };
	record(stat, await writeNote(vault, path, bookshelfOverviewContent(list, details)));
	return stat;
}

/**
 * 把后端随会话下发的「当次数据快照」写入 vault：
 * 藏书 + 阅读计划/笔记合集 + 书架总览。
 */
export interface SyncResult {
	/** 每本书的服务端藏书信息快照，作为反向同步的基线 */
	baseline: Record<string, CollectionSnapshot>;
	/** 书架层/格结构，缓存供位置选择器离线使用 */
	shelves: BookshelfDetailResponse[];
	/** 用户在小程序里定义的自定义标签，缓存供书标签多选使用（后端也按这份清单校验） */
	tags: string[];
	booksCount: number;
}

export async function syncAll(
	plugin: FindMyBookPlugin,
	payload: SyncPayload,
	downloadCover?: CoverDownloader,
): Promise<SyncResult> {
	const books = payload.books?.categories?.flatMap((c) => c.books ?? []) ?? [];
	const plans = payload.plans ?? [];
	const notes = payload.notes ?? [];
	const list: BookshelfListResponse =
		payload.bookshelfList ?? { bookshelves: [], total: 0 };
	const details = payload.bookshelfDetails ?? [];

	const b = await writeBooks(plugin, books, downloadCover);
	const pn = await writePlansAndNotes(plugin, books, plans, notes);
	const ov = await writeBookshelfOverview(plugin, list, details);

	plugin.settings.lastSyncAt = Date.now();
	await plugin.saveSettings();

	new Notice(
		`同步完成｜藏书 新${b.created}/更${b.updated}/略${b.skipped}（${books.length}本` +
			(b.coverFailed > 0 ? `，封面失败 ${b.coverFailed}` : '') +
			'）' +
			`；阅读数据 新${pn.created}/更${pn.updated}/略${pn.skipped}/空${pn.empty}` +
			`；书架总览 新${ov.created}/更${ov.updated}/略${ov.skipped}`,
	);

	const baseline: Record<string, CollectionSnapshot> = {};
	for (const book of books) {
		baseline[String(book.myBookId)] = collectionOf(book);
	}
	return {
		baseline,
		shelves: details,
		tags: payload.tags ?? [],
		booksCount: books.length,
	};
}
