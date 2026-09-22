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

function strList(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	const out: string[] = [];
	for (const item of v as unknown[]) {
		const text = str(item);
		if (text !== '') out.push(text);
	}
	return out;
}

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

async function readPayload(app: App, file: TFile): Promise<NotePayload> {
	try {
		return parsePayload(await app.vault.cachedRead(file));
	} catch {
		return emptyPayload();
	}
}

export interface ReverseScanResult {
	edits: BookEdit[];
	fileById: Map<number, TFile>;
}

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

		const payload = await readPayload(app, file);
		const myBookId = payload.bookId ?? num(fm[LEGACY_BOOK_ID_KEY]);
		if (myBookId == null) continue;
		const base = baseline[String(myBookId)];
		if (!base) continue;

		const changed: Record<string, string> = {};
		for (const field of SCALAR_FIELDS) {
			const cur = field.labels
				? fromLabel(field.labels, str(fm[field.fm]))
				: str(fm[field.fm]);
			if (cur !== str(base[field.snap])) changed[field.snap] = cur;
		}

		const curTags = strList(fm[FM.tagNames]);
		if (JSON.stringify(curTags) !== JSON.stringify(base.tagNames)) {
			changed.tagNames = curTags.join(',');
		}

		const curStatus = fromLabel(STATUS_LABELS, str(fm[FM.bookStatus]));
		const status = curStatus && curStatus !== str(base.bookStatus) ? curStatus : undefined;

		let reading: string | undefined;
		if (Object.prototype.hasOwnProperty.call(base, 'readingStatus')) {
			const curReading = fromLabel(READING_STATUS_LABELS, str(fm[FM.readingStatus]));
			reading = curReading !== str(base.readingStatus) ? curReading : undefined;
		}

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
