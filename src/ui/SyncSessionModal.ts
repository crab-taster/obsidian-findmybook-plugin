import { App, Modal } from 'obsidian';
import QRCode from 'qrcode';
import type FindMyBookPlugin from '../main';
import { FindMyBookApi } from '../api';

/**
 * 同步会话弹窗（一次性传输通道）。
 * 生成 fmbsync://<token> 二维码 -> 轮询会话状态 -> READY 时取回当次数据快照 -> 交给插件写入 vault。
 * 插件全程不保存任何凭据。
 */
export class SyncSessionModal extends Modal {
	private plugin: FindMyBookPlugin;
	private pollTimer: number | null = null;
	private done = false;
	private tipEl!: HTMLElement;

	constructor(app: App, plugin: FindMyBookPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: '同步「书放哪了」' });
		this.tipEl = contentEl.createEl('p', { text: '正在生成同步二维码…' });

		if (!this.plugin.settings.serverUrl) {
			this.tipEl.setText('请先在设置中填写后端服务器地址，再发起同步。');
			return;
		}

		const api = new FindMyBookApi(this.plugin.settings.serverUrl);
		api
			.createSyncSession()
			.then(async (session) => {
				if (this.done) return;
				this.tipEl.setText('用微信「扫一扫」打开，或在小程序内扫码：');
				if (session.codeImage) {
					contentEl.createEl('img', {
						cls: 'fmb-qr',
						attr: {
							src: `data:${session.codeImageType || 'image/png'};base64,${session.codeImage}`,
							alt: '同步小程序码',
						},
					});
				} else {
					// 小程序码生成失败：回退文本二维码（小程序内扫码仍可用）
					const dataUrl = await QRCode.toDataURL(session.qrcodeContent, {
						margin: 1,
						width: 240,
					});
					contentEl.createEl('img', {
						cls: 'fmb-qr',
						attr: { src: dataUrl, alt: '同步二维码' },
					});
				}
				this.startPoll(api, session.token, session.expireSeconds);
			})
			.catch((e: unknown) => {
				const msg = e instanceof Error ? e.message : String(e);
				this.tipEl.setText('生成同步会话失败：' + msg);
			});
	}

	private startPoll(api: FindMyBookApi, token: string, expireSeconds: number): void {
		const deadline = Date.now() + expireSeconds * 1000;
		const tick = () => {
			if (this.done) return;
			if (Date.now() > deadline) {
				this.stopPoll();
				this.tipEl.setText('二维码已过期，请重新发起同步。');
				return;
			}
			api
				.getSyncSession(token)
				.then((s) => {
					if (this.done) return;
					if (s.status === 'READY' && s.payload) {
						this.done = true;
						this.stopPoll();
						this.tipEl.setText('已收到数据，正在写入 vault（含封面下载）…');
						this.close();
						void this.plugin.applySyncPayload(s.payload, token);
					}
				})
				.catch(() => {
					/* 网络抖动，继续轮询 */
				});
		};
		this.pollTimer = window.setInterval(tick, 2000);
		tick();
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
