/** Pure citation and page rules. The host adapter checks that the PDF exists. */
export interface Reference {
	path: string;
	citekey: unknown;
	pdf: unknown;
	offset: unknown;
}
export type FailureCode = 'unsupported-citation' | 'missing-reference' | 'ambiguous-reference' | 'invalid-page' | 'invalid-pdf';
export interface Failure { ok: false; code: FailureCode; paths: string[] }
export interface Target {
	ok: true;
	key: string;
	reference: string;
	pdf: string;
	printedPage: number | null;
	offset: number;
	page: number;
}
export type JumpResult = Target | Failure;
export type Citation = { key: string; printedPage: number | null };
const fail = (code: FailureCode, paths: string[] = []): Failure => ({ ok: false, code, paths });
// Punctuation is internal only, so a key never ends in a sentence period or colon.
const KEY = '[\\p{L}\\p{N}_](?:[:.+\\-]*[\\p{L}\\p{N}_])*';

/** Inline code runs are paired by their exact backtick length. */
function inCode(line: string, start: number, end: number): boolean {
	const runs = [...line.matchAll(/`+/g)];
	for (let i = 0; i < runs.length; i++) {
		const a = runs[i]!;
		const j = runs.findIndex((b, k) => k > i && b[0].length === a[0].length);
		if (j < 0) continue;
		const b = runs[j]!;
		if (start < b.index + b[0].length && end > a.index) return true;
		i = j;
	}
	return false;
}

/** Support a single bracketed key with a numeric locator, or a bare key. */
export function parseCitation(line: string, cursor: number): Citation | Failure {
	if (!Number.isInteger(cursor) || cursor < 0 || cursor > line.length) return fail('unsupported-citation');
	const brackets = [...line.matchAll(/\[[^[\]]*\]/g)];
	// The cursor can also stand just after the closing bracket.
	const bracket = brackets.find((m) => cursor >= m.index && cursor < m.index + m[0].length)
		?? brackets.find((m) => cursor === m.index + m[0].length);
	let text: string;
	let start: number;
	let end: number;
	if (bracket) {
		start = bracket.index;
		end = start + bracket[0].length;
		// Reject Markdown links, embeds, escaped brackets and nested brackets.
		if (/[!\\[]/.test(line[start - 1] ?? '') || /^[([]/.test(line.slice(end)) || line[end] === ']') return fail('unsupported-citation');
		text = bracket[0].slice(1, -1).trim();
	} else {
		const keys = [...line.matchAll(new RegExp('-?@' + KEY, 'gu'))];
		const m = keys.find((x) => cursor >= x.index && cursor <= x.index + x[0].length);
		if (!m) return fail('unsupported-citation');
		start = m.index;
		text = m[0];
		end = start + text.length;
		// A malformed bracketed citation must not fall back to a bare key.
		if (line.lastIndexOf('[', start) > line.lastIndexOf(']', start)) return fail('unsupported-citation');
		if (cursor > end || (start > 0 && !/[\s(]/.test(line[start - 1]!))) return fail('unsupported-citation');
		// An unbracketed locator is not part of this supported grammar.
		if (/^\s*,\s*(?:p{1,2}\.\s*)?(?:\d|[ivxlcdm])/i.test(line.slice(end))) return fail('unsupported-citation');
	}
	if (inCode(line, start, end)) return fail('unsupported-citation');
	const m = new RegExp('^-?@(' + KEY + ')(?:\\s*,\\s*(?:p{1,2}\\.\\s*)?([0-9]+)(?:\\s*[-–]\\s*([0-9]+))?)?$', 'u').exec(text);
	if (!m) return fail('unsupported-citation');
	const key = m[1]!;
	if (m[2] === undefined) return { key, printedPage: null };
	const page = Number(m[2]);
	const last = m[3] === undefined ? page : Number(m[3]);
	if (!Number.isSafeInteger(page) || !Number.isSafeInteger(last) || page < 1 || last < page) return fail('invalid-page');
	return { key, printedPage: page };
}

/** PDF values are exact vault paths. Wikilink brackets and display aliases are accepted. */
export function localPdfPath(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	let path = value.trim();
	if (path.startsWith('[[') && path.endsWith(']]')) path = path.slice(2, -2).split('|')[0]!.trim();
	if ([...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
	if (!path || /[:#^\\[\]|%]/.test(path) || /^[~/]/.test(path) || path.split('/').some((s) => !s || s === '.' || s === '..') || !/\.pdf$/i.test(path)) return null;
	return path;
}

export function resolveCitation(line: string, cursor: number, references: Reference[]): JumpResult {
	const citation = parseCitation(line, cursor);
	if ('ok' in citation) return citation;
	const matches = references.filter((r) => typeof r.citekey === 'string' && r.citekey.trim() === citation.key);
	if (!matches.length) return fail('missing-reference');
	if (matches.length > 1) return fail('ambiguous-reference', matches.map((r) => r.path).sort());
	const ref = matches[0]!;
	const offset = ref.offset === undefined ? 0 : ref.offset;
	if (typeof offset !== 'number' || !Number.isSafeInteger(offset)) return fail('invalid-page', [ref.path]);
	const page = citation.printedPage === null ? 1 : citation.printedPage + offset;
	if (!Number.isSafeInteger(page) || page < 1) return fail('invalid-page', [ref.path]);
	const pdf = localPdfPath(ref.pdf);
	if (pdf === null) return fail('invalid-pdf', [ref.path]);
	return { ok: true, key: citation.key, reference: ref.path, pdf, printedPage: citation.printedPage, offset, page };
}

const INDENT = /^( {4}|\t)/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:\s|$)/;
const NOT_PARAGRAPH = /^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|(?:[-*_]\s*){3,}$)/;

/** An indented line is code only after a blank line or a block that is not a paragraph, and never inside a list item. */
function indentedCode(lines: string[], i: number): boolean {
	if (!INDENT.test(lines[i] ?? '')) return false;
	let j = i - 1;
	while (j >= 0 && (!lines[j]!.trim() || INDENT.test(lines[j]!))) j--;
	if (j < 0) return true;
	if (LIST_ITEM.test(lines[j]!)) return false;
	// Indented lines directly under a paragraph line continue that paragraph.
	let r = i;
	while (r > j + 1 && lines[r - 1]!.trim()) r--;
	return r !== j + 1 || NOT_PARAGRAPH.test(lines[j]!);
}

/** Reject fenced code, frontmatter and indented code before parsing the current line. */
export function unsupportedContext(lines: string[], cursorLine: number): boolean {
	let fence: { char: string; length: number } | null = null;
	let frontmatter = lines[0]?.trim() === '---';
	for (let i = 0; i <= cursorLine; i++) {
		const line = lines[i] ?? '';
		if (frontmatter) {
			if (i === cursorLine) return true;
			if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
			continue;
		}
		const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (m) {
			if (i === cursorLine) return true;
			if (!fence) fence = { char: m[1]![0]!, length: m[1]!.length };
			else if (m[1]![0] === fence.char && m[1]!.length >= fence.length && !m[2]!.trim()) fence = null;
		} else if (i === cursorLine && (fence !== null || indentedCode(lines, i))) return true;
	}
	return false;
}
