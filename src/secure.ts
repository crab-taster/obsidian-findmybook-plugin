/**
 * 服务器地址的本地混淆存储。
 *
 * 说明：Obsidian 插件设置以明文 JSON 存在 vault 的 data.json 中，插件端没有可用的系统密钥库，
 * 因此这里做的是「混淆」而非密码学意义上的加密——密钥内嵌在打包产物里，
 * 目的是避免服务器地址在 data.json 中以明文直接可读，而非抵御有能力的攻击者。
 */

const KEY = 'fmb::server-url::v1';
const PREFIX = 'v1:';

function xor(bytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		out[i] = (bytes[i] ?? 0) ^ KEY.charCodeAt(i % KEY.length);
	}
	return out;
}

/** 明文 -> 混淆串（空串原样返回） */
export function obfuscate(text: string): string {
	if (!text) return '';
	const bytes = xor(new TextEncoder().encode(text));
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return PREFIX + btoa(bin);
}

/** 混淆串 -> 明文；对无前缀的历史明文值原样返回（向后兼容） */
export function deobfuscate(stored: string): string {
	if (!stored) return '';
	if (!stored.startsWith(PREFIX)) return stored;
	try {
		const bin = atob(stored.slice(PREFIX.length));
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		return new TextDecoder().decode(xor(bytes));
	} catch {
		return '';
	}
}
