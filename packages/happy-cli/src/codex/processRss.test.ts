import { describe, expect, it } from 'vitest';
import { sampleProcessRssKb } from './processRss';

describe('sampleProcessRssKb', () => {
    it('returns null for invalid or stale pids', async () => {
        await expect(sampleProcessRssKb(0)).resolves.toBeNull();
        await expect(sampleProcessRssKb(-1)).resolves.toBeNull();
        await expect(sampleProcessRssKb(99_999_999)).resolves.toBeNull();
    });

    it('samples the current process where a true RSS source is supported', async () => {
        const sample = await sampleProcessRssKb(process.pid);

        if (process.platform === 'win32') {
            expect(sample).toBeNull();
        } else if (process.platform === 'linux' || process.platform === 'darwin') {
            expect(sample).toEqual(expect.any(Number));
            expect(sample).toBeGreaterThan(0);
        } else {
            expect(sample).toBeNull();
        }
    });
});
