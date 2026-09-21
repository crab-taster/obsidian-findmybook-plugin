/**
 * 笔记契约：frontmatter 字段名、归属判据、枚举值中文标签、隐藏载荷。
 *
 * - 字段名集中在 `FM` 里定义，改名只需动这一处（记住：Obsidian 的属性名是
 *   **全库同名同类型**的，改中文名会影响你在其他笔记里同名属性的类型设置）。
 * - 值是后端英文枚举的字段（书况 / 获取渠道 / 藏书状态）在写笔记时转成中文标签，
 *   反向同步时再转回英文码，见 `toLabel` / `fromLabel`。
 * - 机器字段（书籍ID、摆放位置的三个 ID）**不进属性面板**，藏在正文的 `fmb-position`
 *   代码块里（阅读模式只显示成按钮，源码模式才看得到那行 JSON），见文件末尾。
 */

/** frontmatter 字段名 */
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
	/** 定价（人民币折算数字串，只读）：源自 UnifiedBook，与「购入价格」不同源 */
	listPrice: '定价',
	/** 定价的原币展示串（如 US$21.41）；纯人民币定价时为空，避免和主值重复 */
	listPriceOriginal: '定价原币',
	/** 折算定价所用的汇率；纯人民币定价时为空。随每次同步刷新 */
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

/** `来源` 的固定取值：所有同步产物都会写入该标记 */
export const SOURCE_MARKER = '书放哪了';

/**
 * 迁移期兼容：书籍ID 曾经是 frontmatter 属性，现在藏在隐藏载荷里。
 * 只用于读取旧笔记的兜底（新写入的笔记不会再写这个属性）。
 */
export const LEGACY_BOOK_ID_KEY = '书籍ID';

// ===== 枚举值标签（英文码 <-> 中文）=====

/** 对应后端 VALID_BOOK_STATUSES */
export const STATUS_LABELS: Record<string, string> = {
	ON_SHELF: '在架',
	BORROWED: '出借',
	GIFTED: '赠送',
	SOLD: '卖出',
	LOST: '遗失',
};

/** 后端 bookCondition 仅接受 NEW / SECOND_HAND */
export const CONDITION_LABELS: Record<string, string> = {
	NEW: '全新',
	SECOND_HAND: '二手',
};

/** 对应后端 readingStatus（本人阅读旅程派生，无旅程 = NOT_STARTED） */
export const READING_STATUS_LABELS: Record<string, string> = {
	READING: '正在读',
	SHELVED: '已搁置',
	FINISHED: '已读完',
	NOT_STARTED: '还没读',
};

/** 后端 acquisitionChannel 白名单 */
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

/** 装帧规范码 -> 中文（全项目唯一实现见后端 util/BindingType） */
export const BINDING_LABELS: Record<string, string> = {
	SIMPLE: '简装',
	PAPERBACK: '平装',
	FLEXIBOUND: '软精装',
	HARDCOVER: '精装',
	SPECIAL: '特装',
	UNKNOWN: '未知',
};

/** 纸质规范码 -> 中文（全项目唯一实现见后端 util/PaperType） */
export const PAPER_TYPE_LABELS: Record<string, string> = {
	LIGHT: '轻型纸',
	OFFSET: '胶版纸',
	WRITING: '书写纸',
	COATED: '铜版纸',
	UNKNOWN: '未知',
};

/** 英文码 -> 中文标签；未知值原样返回，不丢信息 */
export function toLabel(labels: Record<string, string>, code: string): string {
	if (!code) return '';
	return labels[code] ?? code;
}

/**
 * 中文标签 -> 英文码。未知值原样返回：既兼容直接填英文码，也让后端去校验报错，
 * 而不是在这里静默丢弃。
 */
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

/** 该 frontmatter 是否来自本插件的同步笔记（认 `来源` 标记；书籍ID 在隐藏载荷里） */
export function isFindMyBookNote(fm: unknown): boolean {
	if (!fm || typeof fm !== 'object') return false;
	return prop(fm, FM.source) === SOURCE_MARKER;
}

// ===== 隐藏载荷 =====
//
// 后端改位置只认 bookshelfId / gridId / bookIndexInGrid 三个 ID，书籍ID 更是纯机器字段，
// 但属性面板里没必要出现这些字段——所以它们藏在笔记正文的 `fmb-position` 代码块里
// （阅读/实时预览模式下只显示成「选择摆放位置」按钮，源码模式才看得到那行 JSON）。
// 属性面板里只保留人类可读的 `摆放位置` 展示串。

/** 隐藏载荷：书籍ID + 摆放位置的三个 ID（null = 未指定） */
export interface NotePayload {
	bookId: number | null;
	bookshelfId: number | null;
	gridId: number | null;
	bookIndexInGrid: number | null;
}

/** 载荷里的值：可能来自 API 的 number、frontmatter 的 `''`、或缺失 */
export type PayloadValue = number | string | null | undefined;

/** 要写入的载荷（`undefined` = 保留原值，用于局部更新） */
export interface PayloadPatch {
	bookId?: PayloadValue;
	bookshelfId?: PayloadValue;
	gridId?: PayloadValue;
	bookIndexInGrid?: PayloadValue;
}

/** 载荷代码块的语言名（`registerMarkdownCodeBlockProcessor` 用它） */
export const PAYLOAD_BLOCK = 'fmb-position';

/** 载荷代码块的起始围栏 */
export const PAYLOAD_FENCE = '```' + PAYLOAD_BLOCK;

/** 全空的载荷 */
export function emptyPayload(): NotePayload {
	return { bookId: null, bookshelfId: null, gridId: null, bookIndexInGrid: null };
}

function toNum(v: PayloadValue): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
	return null;
}

/** 载荷 -> 代码块里的一行 JSON（只写有值的键，全空时写 `{}`） */
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

/** 载荷代码块的三行内容（正文里追加用） */
export function payloadBlockLines(p: PayloadPatch): string[] {
	return [PAYLOAD_FENCE, serializePayload(p), '```'];
}

const PAYLOAD_BLOCK_RE = new RegExp(
	'^' + PAYLOAD_FENCE + '[ \\t]*\\r?\\n([\\s\\S]*?)^[ \\t]*```[ \\t]*$',
	'm',
);

/** 从笔记正文解析载荷；没有代码块或内容不是合法 JSON 时返回空载荷 */
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

/**
 * 写载荷进笔记正文：已有代码块则整体替换，否则在末尾追加一个。
 * `patch` 里没给的键保留原值，因此位置选择器只传位置、不会把书籍ID冲掉。
 */
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

// ===== 摆放位置展示串 =====
//
// 格式固定为 `{书架名}-第{层}层-第{列}列-第{本}本`（后端 buildLocationString 的约定）。
// 注意书架名**自己可以含 `-`**（实测有「南次卧-右侧书架」），所以只能从**尾部**剥掉层级后缀，
// 不能按 `-` 切分。拼与拆都走这里，避免两处格式各自漂移（漂移会静默让「按书架筛选」失效）。

/** 层级后缀（层-列-本）；`\s*` 容忍手改时打出的空格 */
const LOCATION_TAIL_RE = /-第\s*(\d+)\s*层-第\s*(\d+)\s*列-第\s*(\d+)\s*本\s*$/;

/** 拼位置展示串；`bookIndex1Based` 是面板里的「第几本」，从 1 起 */
export function locationString(
	shelfName: string,
	layerIndex: number,
	positionInLayer: number,
	bookIndex1Based: number,
): string {
	return `${shelfName}-第${layerIndex}层-第${positionInLayer}列-第${bookIndex1Based}本`;
}

/** 从位置展示串里取书架名；无层级后缀（未上架 / 被手改成自由文本）时返回空串 */
export function shelfNameOf(location: string): string {
	const t = location.trim();
	if (!t) return '';
	const m = LOCATION_TAIL_RE.exec(t);
	if (!m) return '';
	return t.slice(0, m.index).trim();
}
