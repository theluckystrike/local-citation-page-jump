import { describe, expect, it } from 'vitest';
import vectors from './vectors/local-citation-page-jump.json';
import { resolveCitation, type Reference } from '../src/citation';

describe('golden citation vectors', () => {
	it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => {
		const [line, cursor, refs] = c.args as [string, number, Reference[]];
		expect(resolveCitation(line, cursor, refs)).toEqual(c.expected);
	});
});
