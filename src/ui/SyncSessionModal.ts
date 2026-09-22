import { App, Modal } from 'obsidian';
import QRCode from 'qrcode';
import type FindMyBookPlugin from '../main';
import { FindMyBookApi, SERVER_URL } from '../api';

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

		const api = new FindMyBookApi(SERVER_URL);
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
