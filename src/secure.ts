const KEY = 'fmb::server-url::v1';
const PREFIX = 'v1:';

function xor(bytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		out[i] = (bytes[i] ?? 0) ^ KEY.charCodeAt(i % KEY.length);
	}
	return out;
}

export function obfuscate(text: string): string {
	if (!text) return '';
	const bytes = xor(new TextEncoder().encode(text));
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return PREFIX + btoa(bin);
}

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
