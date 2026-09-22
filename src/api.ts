import { requestUrl } from 'obsidian';
import { deobfuscate } from './secure';
import {
	ApiError,
	SyncSessionCreate,
	SyncSessionStatus,
	UploadEdits,
	CoverBytes,
} from './types';

function extFromContentType(ct: string | undefined): string {
	const v = (ct ?? '').toLowerCase();
	if (v.includes('png')) return 'png';
	if (v.includes('webp')) return 'webp';
	if (v.includes('gif')) return 'gif';
	if (v.includes('bmp')) return 'bmp';
	if (v.includes('jpeg') || v.includes('jpg')) return 'jpg';
	return 'jpg';
}

function errorMessage(resp: { status: number; json: unknown }): string {
	const fallback = `请求失败 (${resp.status})`;
	try {
		const e = resp.json as ApiError;
		return e && e.error ? e.error : fallback;
	} catch {
		return fallback;
	}
}

export const SERVER_URL = deobfuscate('v1:DhkWSklJSl0aABteHRsVW1VYUghXWgoCSw==');

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
			throw new Error(errorMessage(resp));
		}
		return resp.json as T;
	}

	async createSyncSession(direction?: 'DOWNLOAD' | 'UPLOAD'): Promise<SyncSessionCreate> {
		const q = direction ? `?direction=${direction}` : '';
		return this.req<SyncSessionCreate>('POST', `/wx/auth/sync-session/create${q}`);
	}

	async submitEdits(token: string, edits: UploadEdits): Promise<{ success: boolean }> {
		return this.req<{ success: boolean }>('POST', '/wx/auth/sync-session/upload', {
			token,
			...edits,
		});
	}

	async getSyncSession(token: string): Promise<SyncSessionStatus> {
		return this.req<SyncSessionStatus>(
			'GET',
			`/wx/auth/sync-session/status?token=${encodeURIComponent(token)}`,
		);
	}

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
