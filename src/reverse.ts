import { App, TFile } from 'obsidian';
import { BookEdit } from './types';
import { CollectionSnapshot } from './sync';
import {
	FM,
	CHANNEL_LABELS,
	CONDITION_LABELS,
	STATUS_LABELS,
	READING_STATUS_LABELS,
	LEGACY_BOOK_ID_KEY,
	NotePayload,
	emptyPayload,
	fromLabel,
	isFindMyBookNote,
	parsePayload,
} from './noteMeta';

/**
 * 可自由编辑的标量字段：frontmatter 字段名 -> 基线字段名。
 * 枚举字段附带「中文标签 -> 英文码」映射，比较与回传前都要先转回后端码值。
 */
const SCALAR_FIELDS: Array<{
	fm: string;
	snap: keyof CollectionSnapshot;
	labels?: Record<string, string>;
}> = [
	{ fm: FM.collectionDate, snap: 'collectionDate' },
	{ fm: FM.bookCondition, snap: 'bookCondition', labels: CONDITION_LABELS },
	{ fm: FM.acquisitionChannel, snap: 'acquisitionChannel', labels: CHANNEL_LABELS },
	{ fm: FM.purchasePrice, snap: 'purchasePrice' },
	{ fm: FM.remark, snap: 'remark' },
];

function str(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return JSON.stringify(v) ?? '';
}

function num(v: unknown): number | null {
	if (typeof v === 'number') return v;
	if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
	return null;
}

/** frontmatter 的列表字段（书标签等）统一成非空字符串数组 */
function strList(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	const out: string[] = [];
	for (const item of v as unknown[]) {
		const text = str(item);
		if (text !== '') out.push(text);
	}
	return out;
}

/**
 * 从 frontmatter（+ 正文隐藏载荷）读出藏书信息快照，用于成功回传后刷新基线。
 * 枚举值一律转回英文码：基线里存的、以及回传给后端的，都是后端码值。
 */
export function snapshotFromFrontmatter(
	fm: Record<string, unknown>,
	payload: NotePayload,
): CollectionSnapshot {
	return {
		location: str(fm[FM.location]),
		collectionDate: str(fm[FM.collectionDate]),
		bookCondition: fromLabel(CONDITION_LABELS, str(fm[FM.bookCondition])),
		acquisitionChannel: fromLabel(CHANNEL_LABELS, str(fm[FM.acquisitionChannel])),
		purchasePrice: str(fm[FM.purchasePrice]),
		remark: str(fm[FM.remark]),
		tagNames: strList(fm[FM.tagNames]),
		bookStatus: fromLabel(STATUS_LABELS, str(fm[FM.bookStatus])),
		readingStatus: fromLabel(READING_STATUS_LABELS, str(fm[FM.readingStatus])),
		bookshelfId: payload.bookshelfId ?? '',
		gridId: payload.gridId ?? '',
		bookIndexInGrid: payload.bookIndexInGrid ?? '',
	};
}

/** 从笔记正文读出隐藏载荷；读取/解析失败按空载荷处理，不让单张坏笔记打断整次扫描 */
async function readPayload(app: App, file: TFile): Promise<NotePayload> {
	try {
		return parsePayload(await app.vault.cachedRead(file));
	} catch {
		return emptyPayload();
	}
}

export interface ReverseScanResult {
	/** 需要回传的改动（每本一条） */
	edits: BookEdit[];
	/** myBookId -> 笔记文件（成功后刷新基线用） */
	fileById: Map<number, TFile>;
}

/**
 * 扫描同步目录下的藏书笔记，对比基线，收集用户改过的藏书信息。
 * 只对「有基线的书」做 diff（否则无从判断哪些是改动），位置改动要求三个 ID 齐全。
 */
export async function collectEdits(
	app: App,
	folder: string,
	baseline: Record<string, CollectionSnapshot>,
): Promise<ReverseScanResult> {
	const target = folder.trim();
	const edits: BookEdit[] = [];
	const fileById = new Map<number, TFile>();

	for (const file of app.vault.getMarkdownFiles()) {
		const parentPath = file.parent ? file.parent.path : '';
		if (parentPath !== target) continue;
		if (file.name === '书架总览.md') continue;

		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm || !isFindMyBookNote(fm)) continue;

		// 书籍ID 与位置都在正文的隐藏载荷里（旧笔记回退到原来的 frontmatter 属性）
		const payload = await readPayload(app, file);
		const myBookId = payload.bookId ?? num(fm[LEGACY_BOOK_ID_KEY]);
		if (myBookId == null) continue;
		const base = baseline[String(myBookId)];
		if (!base) continue; // 无基线，跳过以免误推

		// 标量字段（枚举值先转回英文码，再与基线比较）
		const changed: Record<string, string> = {};
		for (const field of SCALAR_FIELDS) {
			const cur = field.labels
				? fromLabel(field.labels, str(fm[field.fm]))
				: str(fm[field.fm]);
			if (cur !== str(base[field.snap])) changed[field.snap] = cur;
		}

		// 标签（列表）
		const curTags = strList(fm[FM.tagNames]);
		if (JSON.stringify(curTags) !== JSON.stringify(base.tagNames)) {
			changed.tagNames = curTags.join(',');
		}

		// 状态
		const curStatus = fromLabel(STATUS_LABELS, str(fm[FM.bookStatus]));
		const status = curStatus && curStatus !== str(base.bookStatus) ? curStatus : undefined;

		// 阅读状态（派生态：仅在基线已记录该字段时比对，避免旧基线（无该字段）误报）
		let reading: string | undefined;
		if (Object.prototype.hasOwnProperty.call(base, 'readingStatus')) {
			const curReading = fromLabel(READING_STATUS_LABELS, str(fm[FM.readingStatus]));
			reading = curReading !== str(base.readingStatus) ? curReading : undefined;
		}

		// 位置（同样来自隐藏载荷；三个 ID 齐备才算有效改动）
		const sid = payload.bookshelfId;
		const gid = payload.gridId;
		const idx = payload.bookIndexInGrid;
		let positionEdit: BookEdit['position'];
		const posChanged =
			str(sid) !== str(base.bookshelfId) ||
			str(gid) !== str(base.gridId) ||
			str(idx) !== str(base.bookIndexInGrid);
		if (posChanged && sid != null && gid != null) {
			positionEdit = { bookshelfId: sid, gridId: gid, bookIndexInGrid: idx };
		}

		if (Object.keys(changed).length === 0 && !status && !reading && !positionEdit) continue;

		const edit: BookEdit = { myBookId };
		if (Object.keys(changed).length > 0) edit.collection = changed;
		if (status) edit.status = status;
		if (reading) edit.readingStatus = reading;
		if (positionEdit) edit.position = positionEdit;
		edits.push(edit);
		fileById.set(myBookId, file);
	}

	return { edits, fileById };
}
