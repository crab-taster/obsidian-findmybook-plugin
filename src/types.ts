export interface ApiError {
	error: string;
}

export type SyncDirection = 'DOWNLOAD' | 'UPLOAD';
export type SyncStatusName = 'PENDING' | 'READY' | 'APPLIED' | 'EXPIRED';

export interface SyncSessionCreate {
	token: string;
	scene: string;
	qrcodeContent: string;
	codeImage?: string;
	codeImageType?: string;
	expireSeconds: number;
	status: SyncStatusName;
	direction: SyncDirection;
}

export interface SyncSessionStatus {
	status: SyncStatusName;
	direction?: SyncDirection;
	payload?: SyncPayload;
	result?: ApplyResult;
}

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

export interface SortedBook {
	myBookId: number;
	unifiedBookId?: number | null;
	title: string;
	author?: string;
	publisher?: string;
	edition?: string;
	printing?: string;
	wordCount?: string;
	binding?: string | null;
	paperType?: string | null;
	intro?: string | null;
	category?: string;
	bookStatus?: string;
	readingStatus?: string | null;
	location?: string;
	clcNumber?: string;
	clcFinestName?: string;
	hasCover?: boolean;
	isbn?: string;
	collectionDate?: string | null;
	bookCondition?: string | null;
	acquisitionChannel?: string | null;
	purchasePrice?: number | null;
	purchasePriceCurrency?: string | null;
	purchasePriceRaw?: string | null;
	remark?: string | null;
	tagNames?: string | null;
	bookshelfId?: number | null;
	bookGridId?: number | null;
	bookIndexInGrid?: number | null;
	price?: string | null;
	priceInfo?: PriceInfo | null;
}

export interface PriceInfo {
	amount?: string | null;
	currency?: string | null;
	symbol?: string | null;
	display?: string | null;
	isConverted?: boolean;
	convertedDisplay?: string | null;
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

export interface ReadingPlan {
	id: number;
	myBookId: number;
	totalPages: number;
	startPage: number;
	pagesToRead: number;
	dailyPages: number;
	startDate: string;
	status: string;
	createdAt?: string;
}

export interface ReadingNote {
	id: number;
	myBookId: number;
	unifiedBookId?: number | null;
	page?: number | null;
	content: string;
	imageUrl?: string | null;
	createdAt?: string;
}

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
	gridPosition: string;
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

export interface SyncPayload {
	version: number;
	generatedAt: number;
	books: SortedBooksResponse;
	plans: ReadingPlan[];
	notes: ReadingNote[];
	bookshelfList: BookshelfListResponse;
	bookshelfDetails: BookshelfDetailResponse[];
	tags?: string[];
}

export interface BookEdit {
	myBookId: number;
	collection?: Record<string, string>;
	status?: string;
	readingStatus?: string;
	position?: { bookshelfId: number; gridId: number; bookIndexInGrid?: number | null };
}

export interface UploadEdits {
	books: BookEdit[];
}

export interface CoverBytes {
	bytes: ArrayBuffer;
	ext: string;
}
