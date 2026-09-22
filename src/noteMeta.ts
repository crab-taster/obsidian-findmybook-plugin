export const FM = {
	source: '来源',
	syncedAt: '同步时间',
	title: '书名',
	author: '作者',
	publisher: '出版社',
	edition: '版次',
	printing: '印次',
	wordCount: '字数',
	binding: '装帧',
	paperType: '纸质',
	listPrice: '定价',
	listPriceOriginal: '定价原币',
	listPriceRate: '定价汇率',
	isbn: 'ISBN',
	category: '分类',
	clcNumber: '中图分类号',
	coverFile: '封面',
	location: '摆放位置',
	collectionDate: '购入日期',
	bookCondition: '书况',
	acquisitionChannel: '获取渠道',
	purchasePrice: '购入价格',
	remark: '备注',
	tagNames: '书标签',
	bookStatus: '藏书状态',
	readingStatus: '阅读状态',
} as const;

export const SOURCE_MARKER = '书放哪了';

export const LEGACY_BOOK_ID_KEY = '书籍ID';

export const STATUS_LABELS: Record<string, string> = {
	ON_SHELF: '在架',
	BORROWED: '出借',
	GIFTED: '赠送',
	SOLD: '卖出',
	LOST: '遗失',
};

export const CONDITION_LABELS: Record<string, string> = {
	NEW: '全新',
	SECOND_HAND: '二手',
};

export const READING_STATUS_LABELS: Record<string, string> = {
	READING: '正在读',
	SHELVED: '已搁置',
	FINISHED: '已读完',
	NOT_STARTED: '还没读',
};

export const CHANNEL_LABELS: Record<string, string> = {
	GIFT: '他人赠送',
	BORROW: '借入',
	JD: '京东',
	DANGDANG: '当当',
	TAOBAO: '淘宝',
	DOUYIN: '抖音',
	PINDUODUO: '拼多多',
	KONGFUZI: '孔夫子',
	XIANYU: '闲鱼',
	DUOZHUAYU: '多抓鱼',
	BOOKSTORE: '实体书店',
};

export const BINDING_LABELS: Record<string, string> = {
	SIMPLE: '简装',
	PAPERBACK: '平装',
	FLEXIBOUND: '软精装',
	HARDCOVER: '精装',
	SPECIAL: '特装',
	UNKNOWN: '未知',
};

export const PAPER_TYPE_LABELS: Record<string, string> = {
	LIGHT: '轻型纸',
	OFFSET: '胶版纸',
	WRITING: '书写纸',
	COATED: '铜版纸',
	UNKNOWN: '未知',
};

export function toLabel(labels: Record<string, string>, code: string): string {
	if (!code) return '';
	return labels[code] ?? code;
}

export function fromLabel(labels: Record<string, string>, text: string): string {
	const t = text.trim();
	if (!t) return '';
	for (const code of Object.keys(labels)) {
		if (labels[code] === t) return code;
	}
	return t;
}

function prop(obj: object, key: string): unknown {
	return (obj as Record<string, unknown>)[key];
}

export function isFindMyBookNote(fm: unknown): boolean {
	if (!fm || typeof fm !== 'object') return false;
	return prop(fm, FM.source) === SOURCE_MARKER;
}

export interface NotePayload {
	bookId: number | null;
	bookshelfId: number | null;
	gridId: number | null;
	bookIndexInGrid: number | null;
}

export type PayloadValue = number | string | null | undefined;

export interface PayloadPatch {
	bookId?: PayloadValue;
	bookshelfId?: PayloadValue;
	gridId?: PayloadValue;
	bookIndexInGrid?: PayloadValue;
}

export const PAYLOAD_BLOCK = 'fmb-position';

export const PAYLOAD_FENCE = '```' + PAYLOAD_BLOCK;

export function emptyPayload(): NotePayload {
	return { bookId: null, bookshelfId: null, gridId: null, bookIndexInGrid: null };
}

function toNum(v: PayloadValue): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
	return null;
}

export function serializePayload(p: PayloadPatch): string {
	const out: Record<string, number> = {};
	const id = toNum(p.bookId);
	const shelf = toNum(p.bookshelfId);
	const grid = toNum(p.gridId);
	const index = toNum(p.bookIndexInGrid);
	if (id !== null) out.id = id;
	if (shelf !== null) out.bookshelfId = shelf;
	if (grid !== null) out.gridId = grid;
	if (index !== null) out.bookIndexInGrid = index;
	return JSON.stringify(out);
}

export function payloadBlockLines(p: PayloadPatch): string[] {
	return [PAYLOAD_FENCE, serializePayload(p), '```'];
}

const PAYLOAD_BLOCK_RE = new RegExp(
	'^' + PAYLOAD_FENCE + '[ \\t]*\\r?\\n([\\s\\S]*?)^[ \\t]*```[ \\t]*$',
	'm',
);

export function parsePayload(noteText: string): NotePayload {
	const m = PAYLOAD_BLOCK_RE.exec(noteText);
	if (!m || m[1] === undefined) return emptyPayload();
	try {
		const raw: unknown = JSON.parse(m[1].trim());
		if (!raw || typeof raw !== 'object') return emptyPayload();
		const obj = raw as Record<string, unknown>;
		return {
			bookId: toNum(obj.id as PayloadValue),
			bookshelfId: toNum(obj.bookshelfId as PayloadValue),
			gridId: toNum(obj.gridId as PayloadValue),
			bookIndexInGrid: toNum(obj.bookIndexInGrid as PayloadValue),
		};
	} catch {
		return emptyPayload();
	}
}

export function upsertPayloadBlock(noteText: string, patch: PayloadPatch): string {
	const cur = parsePayload(noteText);
	const pick = (v: PayloadValue, fallback: number | null): PayloadValue =>
		v === undefined ? fallback : v;
	const next: PayloadPatch = {
		bookId: pick(patch.bookId, cur.bookId),
		bookshelfId: pick(patch.bookshelfId, cur.bookshelfId),
		gridId: pick(patch.gridId, cur.gridId),
		bookIndexInGrid: pick(patch.bookIndexInGrid, cur.bookIndexInGrid),
	};
	const block = payloadBlockLines(next).join('\n');
	if (PAYLOAD_BLOCK_RE.test(noteText)) {
		return noteText.replace(PAYLOAD_BLOCK_RE, block);
	}
	return noteText.replace(/\s+$/, '') + '\n\n' + block + '\n';
}

const LOCATION_TAIL_RE = /-第\s*(\d+)\s*层-第\s*(\d+)\s*列-第\s*(\d+)\s*本\s*$/;

export function locationString(
	shelfName: string,
	layerIndex: number,
	positionInLayer: number,
	bookIndex1Based: number,
): string {
	return `${shelfName}-第${layerIndex}层-第${positionInLayer}列-第${bookIndex1Based}本`;
}

export function shelfNameOf(location: string): string {
	const t = location.trim();
	if (!t) return '';
	const m = LOCATION_TAIL_RE.exec(t);
	if (!m) return '';
	return t.slice(0, m.index).trim();
}
