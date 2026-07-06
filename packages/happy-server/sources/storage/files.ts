import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'minio';

export interface FilesConfig {
    dataDir?: string;
    publicUrl?: string;
    s3?: {
        host: string;
        port?: number;
        useSSL?: boolean;
        region?: string;
        accessKey: string;
        secretKey: string;
        bucket: string;
        publicUrl: string;
    };
}

let filesConfig: FilesConfig | null = null;
let useLocalStorage = true;
let localFilesDir = path.join('./data', 'files');
let publicUrl: string | undefined;
export let s3client: any = null;
export let s3bucket: string = '';
export let s3host: string = '';
let s3public: string = '';

export function configureFiles(config: FilesConfig) {
    filesConfig = config;
    useLocalStorage = !config.s3;
    localFilesDir = path.join(config.dataDir || './data', 'files');
    publicUrl = config.publicUrl;

    if (!config.s3) {
        s3client = null;
        s3bucket = '';
        s3host = '';
        s3public = '';
        return;
    }

    s3client = new Client({
        endPoint: config.s3.host,
        port: config.s3.port,
        useSSL: config.s3.useSSL ?? true,
        accessKey: config.s3.accessKey,
        secretKey: config.s3.secretKey,
        region: config.s3.region || 'us-east-1',
    });
    s3bucket = config.s3.bucket;
    s3host = config.s3.host;
    s3public = config.s3.publicUrl;
}

function configureFilesFromEnv() {
    if (filesConfig) {
        return;
    }
    configureFiles({
        dataDir: process.env.DATA_DIR || './data',
        publicUrl: process.env.PUBLIC_URL,
        s3: process.env.S3_HOST ? {
            host: process.env.S3_HOST,
            port: process.env.S3_PORT ? parseInt(process.env.S3_PORT, 10) : undefined,
            useSSL: process.env.S3_USE_SSL ? process.env.S3_USE_SSL === 'true' : true,
            region: process.env.S3_REGION || 'us-east-1',
            accessKey: process.env.S3_ACCESS_KEY!,
            secretKey: process.env.S3_SECRET_KEY!,
            bucket: process.env.S3_BUCKET!,
            publicUrl: process.env.S3_PUBLIC_URL!,
        } : undefined,
    });
}

export async function loadFiles() {
    configureFilesFromEnv();
    if (useLocalStorage) {
        fs.mkdirSync(localFilesDir, { recursive: true });
        return;
    }
    await s3client.bucketExists(s3bucket);
}

export function getPublicUrl(filePath: string) {
    configureFilesFromEnv();
    if (useLocalStorage) {
        const baseUrl = publicUrl || `http://localhost:${process.env.PORT || '3005'}`;
        return `${baseUrl}/files/${filePath}`;
    }
    return `${s3public}/${filePath}`;
}

export function isLocalStorage() {
    configureFilesFromEnv();
    return useLocalStorage;
}

export function getLocalFilesDir() {
    configureFilesFromEnv();
    return localFilesDir;
}

export async function putLocalFile(filePath: string, data: Buffer) {
    configureFilesFromEnv();
    const fullPath = path.join(localFilesDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, data);
}

/**
 * Delete all attachments for a session.
 * Local: removes the session attachments directory.
 * S3: deletes all objects with prefix "sessions/{sessionId}/attachments/".
 */
// FORK PATCH: [KEEP] adopted upstream's session-attachment storage GC (cli-1.1.10), adapted to the fork's lazy configureFilesFromEnv() init — upstream reads env at module load, the fork defers storage config to first use, so this helper must prime it before reading useLocalStorage/s3client (invariant HS-17)
export async function deleteSessionAttachments(sessionId: string): Promise<void> {
    configureFilesFromEnv();
    const prefix = `sessions/${sessionId}/attachments`;
    if (useLocalStorage) {
        const dir = path.join(localFilesDir, prefix);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        return;
    }

    // S3: list and delete all objects under the prefix
    const stream = s3client.listObjects(s3bucket, prefix + '/', true);
    const keys: string[] = await new Promise((resolve, reject) => {
        const collected: string[] = [];
        stream.on('data', (obj: { name: string }) => { if (obj.name) collected.push(obj.name); });
        stream.on('end', () => resolve(collected));
        stream.on('error', reject);
    });

    if (keys.length > 0) {
        await s3client.removeObjects(s3bucket, keys);
    }
}

export type ImageRef = {
    width: number;
    height: number;
    thumbhash: string;
    path: string;
}
