// 后端统一错误响应体
export interface ApiError {
	error: string;
}

// ===== 同步会话（一次性传输通道，双向） =====
export type SyncDirection = 'DOWNLOAD' | 'UPLOAD';
export type SyncStatusName = 'PENDING' | 'READY' | 'APPLIED' | 'EXPIRED';

// POST /wx/auth/sync-session/create
export interface SyncSessionCreate {
	/** 会话 token：插件用于轮询/取封面/提交改动，**不显示、不放进码** */
	token: string;
	/** 码里承载的短句柄（只够小程序侧 confirm） */
	scene: string;
	/** 兜底文本二维码内容：fmbsync://<scene> */
	qrcodeContent: string;
	/** 小程序码图片（base64）；生成失败时缺省，插件回退文本二维码 */
	codeImage?: string;
	codeImageType?: string;
	expireSeconds: number;
	status: SyncStatusName;
	direction: SyncDirection;
}

// GET /wx/auth/sync-session/status?token=
export interface SyncSessionStatus {
	status: SyncStatusName;
	direction?: SyncDirection;
	payload?: SyncPayload; // DOWNLOAD READY 时
	result?: ApplyResult; // UPLOAD APPLIED 时
}

// 反向同步回执
export interface ApplyResultItem {
	myBookId: number;
	ok: boolean;
	errors?: { message: string }[];
}

export interface ApplyResult {
	applied: number;
	failed: number;
	items: ApplyResultItem[];
}

// ===== 同步：GET /mybook/sorted-books 响应结构 =====
// 单本书（对应后端 buildSortedBookInfo）
export interface SortedBook {
	myBookId: number;
	unifiedBookId?: number | null;
	title: string;
	author?: string;
	publisher?: string;
	/** 版次（原串，如「第3版」） */
	edition?: string;
	/** 印次（原串，如「第2次印刷」） */
	printing?: string;
	/** 字数（原串，如「300千字」） */
	wordCount?: string;
	/** 装帧（规范码，如 PAPERBACK；中文在插件端 BINDING_LABELS 映射），只读元数据 */
	binding?: string | null;
	/** 纸质（规范码，如 OFFSET；中文在插件端 PAPER_TYPE_LABELS 映射），只读元数据 */
	paperType?: string | null;
	/** 书籍简介（豆瓣 summary，最长约 1000 字），只读元数据 */
	intro?: string | null;
	category?: string;
	bookStatus?: string; // ON_SHELF / BORROWED / GIFTED / SOLD / LOST
	/** 阅读状态（本人阅读旅程派生；无旅程 = NOT_STARTED），只读元数据 */
	readingStatus?: string | null; // READING / SHELVED / FINISHED / NOT_STARTED
	location?: string; // 例如 "第1层第1列-第1本"
	clcNumber?: string;
	clcFinestName?: string;
	/** 是否有封面。封面 URL 不下发，字节由 /wx/auth/sync-session/cover 按需取 */
	hasCover?: boolean;
	isbn?: string;
	// —— 藏书信息（可改） ——
	collectionDate?: string | null; // yyyy-MM-dd
	bookCondition?: string | null; // NEW / SECOND_HAND
	acquisitionChannel?: string | null;
	purchasePrice?: number | null; // 人民币分
	purchasePriceCurrency?: string | null;
	purchasePriceRaw?: string | null;
	remark?: string | null;
	tagNames?: string | null; // 逗号分隔
	// —— 位置 ID（供选择器 / 反向同步） ——
	bookshelfId?: number | null;
	bookGridId?: number | null;
	bookIndexInGrid?: number | null;
	// —— 定价（只读元数据，源自 UnifiedBook；与 MyBooks 上的购入价不同源） ——
	/** 人民币折算后的数字串（如 "143.88"）；无可用汇率时为 null（宁可不显示也不写错数） */
	price?: string | null;
	/** 定价明细：原币展示串 / 所用汇率 / 是否已折算（与小程序详情页同一套） */
	priceInfo?: PriceInfo | null;
}

/** 定价明细（对应后端 UnifiedBook.getPriceInfo()，只取插件用得到的键） */
export interface PriceInfo {
	/** 原币金额数字串，如 "21.41" */
	amount?: string | null;
	currency?: string | null;
	symbol?: string | null;
	/** 原币展示串，如 "US$21.41" */
	display?: string | null;
	/** 是否已按汇率折算成人民币 */
	isConverted?: boolean;
	convertedDisplay?: string | null;
	/** 折算所用汇率，如 "6.72" */
	rate?: string | null;
	rateDate?: string | null;
	rateStale?: boolean;
	rateUnavailableReason?: string | null;
}

export interface SortedBookCategory {
	category: string;
	bookCount: number;
	books: SortedBook[];
}

export interface SortedBooksResponse {
	sortType: string;
	bookshelfIds: number[];
	categories: SortedBookCategory[];
	totalBooks: number;
}

// ===== 阅读计划 =====
export interface ReadingPlan {
	id: number;
	myBookId: number;
	totalPages: number;
	startPage: number;
	pagesToRead: number;
	dailyPages: number;
	startDate: string; // yyyy-MM-dd
	status: string; // NOT_STARTED / IN_PROGRESS / COMPLETED / CANCELLED
	createdAt?: string;
}

// ===== 读书笔记 =====
export interface ReadingNote {
	id: number;
	myBookId: number;
	unifiedBookId?: number | null;
	page?: number | null;
	content: string;
	imageUrl?: string | null;
	createdAt?: string;
}

// ===== 书架 =====
export interface BookshelfInfo {
	id: number;
	name: string;
	imageUrl?: string;
	layerCount?: number;
	gridCount?: number;
	isDefault?: boolean;
}

export interface BookshelfListResponse {
	bookshelves: BookshelfInfo[];
	total: number;
	hasCustomOrder?: boolean;
}

export interface BookGridInfo {
	id: number;
	layerIndex: number;
	positionInLayer: number;
	totalIndex?: number;
	gridPosition: string; // 第N层第M列
	bookCount: number;
}

export interface BookshelfDetailResponse {
	id: number;
	name: string;
	layerCount?: number;
	gridCount?: number;
	isDefault?: boolean;
	grids: BookGridInfo[];
	totalBooks: number;
}

// ===== 后端在 confirm 时组装好的"当次数据快照" =====
export interface SyncPayload {
	version: number;
	generatedAt: number;
	books: SortedBooksResponse;
	plans: ReadingPlan[];
	notes: ReadingNote[];
	bookshelfList: BookshelfListResponse;
	bookshelfDetails: BookshelfDetailResponse[];
	/** 用户在小程序里定义的自定义标签（书标签只能从这里多选，后端也按这份清单校验） */
	tags?: string[];
}

// ===== 反向同步：插件提交的改动 =====
export interface BookEdit {
	myBookId: number;
	/** 收藏字段（部分更新）：collectionDate/bookCondition/acquisitionChannel/purchasePrice/purchasePriceCurrency/remark/tagNames */
	collection?: Record<string, string>;
	/** 书籍状态（走批量状态端点） */
	status?: string;
	/** 阅读状态（派生态，走阅读旅程协调端点） */
	readingStatus?: string;
	/** 位置（走位置端点，需三个 ID） */
	position?: { bookshelfId: number; gridId: number; bookIndexInGrid?: number | null };
}

export interface UploadEdits {
	books: BookEdit[];
}

/** 封面字节 + 推断出的扩展名（用于落盘取名） */
export interface CoverBytes {
	bytes: ArrayBuffer;
	ext: string;
}
