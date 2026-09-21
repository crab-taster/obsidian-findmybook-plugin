import { requestUrl } from 'obsidian';
import {
	ApiError,
	SyncSessionCreate,
	SyncSessionStatus,
	UploadEdits,
	CoverBytes,
} from './types';

/** 由 content-type 推断图片扩展名 */
function extFromContentType(ct: string | undefined): string {
	const v = (ct ?? '').toLowerCase();
	if (v.includes('png')) return 'png';
	if (v.includes('webp')) return 'webp';
	if (v.includes('gif')) return 'gif';
	if (v.includes('bmp')) return 'bmp';
	if (v.includes('jpeg') || v.includes('jpg')) return 'jpg';
	return 'jpg';
}

/**
 * 「书放哪了」后端客户端——只对接「同步会话」这条一次性传输通道。
 *
 * 设计约束：插件不持有任何长期凭据，也不访问任何常规业务接口；
 * 所有数据都由后端在会话确认时组装好，插件仅按会话 token 取走 payload。
 * 使用 Obsidian 内置 requestUrl（移动端兼容，无需 node fetch）。
 */
export class FindMyBookApi {
	constructor(private serverUrl: string) {}

	private base(): string {
		return this.serverUrl.replace(/\/+$/, '');
	}

	private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
		const resp = await requestUrl({
			url: this.base() + path,
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		if (resp.status < 200 || resp.status >= 300) {
			let msg = `请求失败 (${resp.status})`;
			try {
				const e = resp.json as ApiError;
				if (e && e.error) msg = e.error;
			} catch {
				/* 非 JSON 错误体，使用默认信息 */
			}
			throw new Error(msg);
		}
		return resp.json as T;
	}

	/** 发起同步：生成一次性会话与二维码内容（direction=UPLOAD 表示反向同步） */
	async createSyncSession(direction?: 'DOWNLOAD' | 'UPLOAD'): Promise<SyncSessionCreate> {
		const q = direction ? `?direction=${direction}` : '';
		return this.req<SyncSessionCreate>('POST', `/wx/auth/sync-session/create${q}`);
	}

	/** 反向同步：把改过的藏书信息提交进会话，等小程序扫码确认后由后端应用 */
	async submitEdits(token: string, edits: UploadEdits): Promise<{ success: boolean }> {
		return this.req<{ success: boolean }>('POST', '/wx/auth/sync-session/upload', {
			token,
			...edits,
		});
	}

	/** 轮询会话状态；DOWNLOAD READY 时带回数据快照，UPLOAD APPLIED 时带回回执 */
	async getSyncSession(token: string): Promise<SyncSessionStatus> {
		return this.req<SyncSessionStatus>(
			'GET',
			`/wx/auth/sync-session/status?token=${encodeURIComponent(token)}`,
		);
	}

	/**
	 * 会话内取封面字节：后端托管的封面需鉴权（外链也由后端代理），
	 * 插件端不接触任何封面 URL。失败返回 null。
	 */
	async downloadCover(token: string, myBookId: number): Promise<CoverBytes | null> {
		try {
			const resp = await requestUrl({
				url:
					`${this.base()}/wx/auth/sync-session/cover` +
					`?token=${encodeURIComponent(token)}&myBookId=${myBookId}`,
			});
			if (resp.status !== 200) return null;
			return {
				bytes: resp.arrayBuffer,
				ext: extFromContentType(resp.headers['content-type']),
			};
		} catch {
			return null;
		}
	}
}
