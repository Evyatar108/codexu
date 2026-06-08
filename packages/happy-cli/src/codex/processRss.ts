import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

function execFileText(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true, timeout: 1_000 }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout.toString());
        });
    });
}

async function pageSizeBytes(): Promise<number> {
    try {
        const value = Number((await execFileText('getconf', ['PAGESIZE'])).trim());
        return Number.isFinite(value) && value > 0 ? value : 4096;
    } catch {
        return 4096;
    }
}

function parsePositiveInteger(value: string): number | null {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function sampleViaPs(pid: number): Promise<number | null> {
    try {
        const output = await execFileText('ps', ['-o', 'rss=', '-p', String(pid)]);
        return parsePositiveInteger(output);
    } catch {
        return null;
    }
}

async function sampleLinuxProcStatm(pid: number): Promise<number | null> {
    try {
        const statm = await readFile(`/proc/${pid}/statm`, 'utf8');
        const [, rssPagesText] = statm.trim().split(/\s+/);
        const rssPages = parsePositiveInteger(rssPagesText ?? '');
        if (rssPages === null) return null;
        return Math.max(1, Math.round((rssPages * await pageSizeBytes()) / 1024));
    } catch {
        return null;
    }
}

export async function sampleProcessRssKb(pid: number): Promise<number | null> {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (process.platform === 'win32') return null;
    if (process.platform === 'linux') {
        return await sampleLinuxProcStatm(pid) ?? await sampleViaPs(pid);
    }
    if (process.platform === 'darwin') {
        return await sampleViaPs(pid);
    }
    return null;
}
