import { App, PluginSettingTab, Setting } from 'obsidian';
import type FindMyBookPlugin from './main';

export interface FindMyBookSettings {
	/** 「书放哪了」后端地址，例如 https://your-findmybook-server.example.com */
	serverUrl: string;
	/** 藏书笔记写入 vault 的文件夹，留空则写仓库根 */
	syncFolder: string;
	/** 上次同步时间戳（毫秒），null 表示从未同步 */
	lastSyncAt: number | null;
}

export const DEFAULT_SETTINGS: FindMyBookSettings = {
	serverUrl: '',
	syncFolder: '书放哪了',
	lastSyncAt: null,
};

export class FindMyBookSettingTab extends PluginSettingTab {
	plugin: FindMyBookPlugin;

	constructor(app: App, plugin: FindMyBookPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('服务器地址')
			.setDesc('「书放哪了」后端地址，例如 https://your-findmybook-server.example.com')
			.addText((text) =>
				text
					.setPlaceholder('https://your-findmybook-server.example.com')
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (value) => {
						this.plugin.settings.serverUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('同步目录')
			.setDesc('藏书笔记写入 vault 的文件夹，留空则写仓库根。')
			.addText((text) =>
				text
					.setPlaceholder('书放哪了')
					.setValue(this.plugin.settings.syncFolder)
					.onChange(async (value) => {
						this.plugin.settings.syncFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('立即同步')
			.setDesc('生成一次性二维码，用「书放哪了」小程序扫码后把当次数据同步过来（插件不保存任何登录凭据）。')
			.addButton((btn) =>
				btn.setButtonText('同步').setCta().onClick(() => {
					void this.plugin.sync();
				}),
			);

		new Setting(containerEl)
			.setName('反向同步')
			.setDesc('把笔记里改过的藏书信息（购买日期/价格/备注/标签/状态/位置等）回传小程序，同样扫码确认。')
			.addButton((btn) =>
				btn.setButtonText('回传修改').onClick(() => {
					void this.plugin.reverseSync();
				}),
			);

		const last = this.plugin.settings.lastSyncAt;
		new Setting(containerEl)
			.setName('上次同步')
			.setDesc(last ? new Date(last).toLocaleString() : '尚未同步');
	}
}
