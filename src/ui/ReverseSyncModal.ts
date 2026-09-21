import { App, Modal, TFile } from 'obsidian';
import QRCode from 'qrcode';
import type FindMyBookPlugin from '../main';
import { FindMyBookApi } from '../api';
import { BookEdit, ApplyResult } from '../types';
import { snapshotFromFrontmatter } from '../reverse';
import { emptyPayload, parsePayload } from '../noteMeta';

/**
 * 反向同步弹窗：把在 Obsidian 里改过的藏书信息回传小程序。
 * 建上传会话 -> 提交改动 -> 二维码 -> 小程序扫码确认 -> 后端应用 -> 显示回执。
 * 与其他同步一样：插件不落任何凭据，一次一码。
 */
export class ReverseSyncModal extends Modal {
	private plugin: FindMyBookPlugin;
	private edits: BookEdit[];
	private fileById: Map<number, TFile>;
	private pollTimer: number | null = null;
	private done = false;
	private tipEl!: HTMLElement;
	private statusEl!: HTMLElement;

	constructor(
		app: App,
		plugin: FindMyBookPlugin,
		edits: BookEdit[],
		fileById: Map<number, TFile>,
	) {
		super(app);
		this.plugin = plugin;
		this.edits = edits;
		this.fileById = fileById;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: `反向同步（${this.edits.length} 本有改动）` });
		this.tipEl = contentEl.createEl('p', { text: '正在创建上传会话…' });
		this.statusEl = contentEl.createEl('p', { cls: 'fmb-reverse-status' });

		if (!this.plugin.settings.serverUrl) {
			this.tipEl.setText('请先在设置中填写后端服务器地址。');
			return;
		}

		const api = new FindMyBookApi(this.plugin.settings.serverUrl);
		void (async () => {
			try {
				const session = await api.createSyncSession('UPLOAD');
				if (this.done) return;
				await api.submitEdits(session.token, { books: this.edits });
				if (this.done) return;
				this.tipEl.setText('用微信「扫一扫」打开，或在小程序内扫码，确认回传：');
				if (session.codeImage) {
					contentEl.createEl('img', {
						cls: 'fmb-qr',
						attr: {
							src: `data:${session.codeImageType || 'image/png'};base64,${session.codeImage}`,
							alt: '反向同步小程序码',
						},
					});
				} else {
					const dataUrl = await QRCode.toDataURL(session.qrcodeContent, {
						margin: 1,
						width: 240,
					});
					contentEl.createEl('img', {
						cls: 'fmb-qr',
						attr: { src: dataUrl, alt: '反向同步二维码' },
					});
				}
				this.startPoll(api, session.token, session.expireSeconds);
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				this.tipEl.setText('创建上传会话失败：' + msg);
			}
		})();
	}

	private startPoll(api: FindMyBookApi, token: string, expireSeconds: number): void {
		const deadline = Date.now() + expireSeconds * 1000;
		const tick = () => {
			if (this.done) return;
			if (Date.now() > deadline) {
				this.stopPoll();
				this.tipEl.setText('二维码已过期，请重新发起反向同步。');
				return;
			}
			api
				.getSyncSession(token)
				.then((s) => {
					if (this.done) return;
					if (s.status === 'APPLIED' && s.result) {
						this.done = true;
						this.stopPoll();
						void this.finish(s.result);
					}
				})
				.catch(() => {
					/* 网络抖动，继续轮询 */
				});
		};
		this.pollTimer = window.setInterval(tick, 2000);
		tick();
	}

	private async finish(result: ApplyResult): Promise<void> {
		this.tipEl.setText(`回传完成：成功 ${result.applied}，失败 ${result.failed}。`);
		const failedIds = new Set(
			result.items.filter((i) => !i.ok).map((i) => i.myBookId),
		);

		// 成功项：以当前笔记的藏书信息刷新基线（服务器已接受）
		for (const item of result.items) {
			if (!item.ok) continue;
			const file = this.fileById.get(item.myBookId);
			if (!file) continue;
			const fm: Record<string, unknown> | undefined =
				this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;

			// 位置在正文的隐藏载荷里；读不到则沿用原基线的位置，避免误清空
			let payload = emptyPayload();
			try {
				payload = parsePayload(await this.app.vault.cachedRead(file));
			} catch {
				payload = emptyPayload();
			}
			const key = String(item.myBookId);
			const snap = snapshotFromFrontmatter(fm, payload);
			const prev = this.plugin.baseline[key];
			if (snap.bookshelfId === '' && prev) {
				snap.bookshelfId = prev.bookshelfId;
				snap.gridId = prev.gridId;
				snap.bookIndexInGrid = prev.bookIndexInGrid;
			}
			this.plugin.baseline[key] = snap;
		}
		await this.plugin.saveSettings();
		this.plugin.refreshBookshelfViews();

		// 失败项逐条列出原因
		if (failedIds.size > 0) {
			const lines: string[] = ['失败明细：'];
			for (const item of result.items) {
				if (item.ok) continue;
				const why = (item.errors ?? []).map((e) => e.message).join('；');
				lines.push(`· #${item.myBookId}：${why || '未知错误'}`);
			}
			this.statusEl.setText(lines.join('\n'));
			this.statusEl.addClass('fmb-reverse-status-error');
		}
	}

	private stopPoll(): void {
		if (this.pollTimer !== null) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	onClose(): void {
		this.done = true;
		this.stopPoll();
		this.contentEl.empty();
	}
}
