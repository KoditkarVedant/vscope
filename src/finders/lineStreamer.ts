import * as cp from 'child_process';

export type ChunkSizeResolver = (isFirstChunk: boolean, totalCount: number) => number;

export interface LineStreamerOptions {
    cmd: string;
    args: string[];
    cwd: string;
    signal?: AbortSignal;
    maxResults?: number;
    backpressureBufSize?: number;
    chunkSize?: ChunkSizeResolver;
    shell?: boolean;
}

const DEFAULT_CHUNK_SIZE: ChunkSizeResolver = (isFirst, count) => {
    if (isFirst) return 100;
    if (count < 10_000) return 5_000;
    if (count < 50_000) return 20_000;
    return 50_000;
};

export async function* streamLines(opts: LineStreamerOptions): AsyncGenerator<string[]> {
    const {
        cmd,
        args,
        cwd,
        signal,
        maxResults,
        backpressureBufSize = 8000,
        chunkSize = DEFAULT_CHUNK_SIZE,
        shell = false,
    } = opts;

    const proc = cp.spawn(cmd, args, { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] });

    const MAX_BUFFER = backpressureBufSize * 2;
    const lines: string[] = [];
    let buf = '';
    let done = false;
    let errored = false;
    let resolveNext: (() => void) | null = null;

    const wake = () => {
        resolveNext?.();
        resolveNext = null;
    };

    let closeResolve: () => void = () => {};
    const closePromise = new Promise<void>((res) => { closeResolve = res; });

    // Abort path: kill the process AND wake the generator. Killing alone isn't enough — on
    // Windows or after a severed pipe, stdout 'end' may not fire, leaving the await hung.
    const abortHandler = () => {
        if (!proc.killed) proc.kill();
        done = true;
        wake();
    };
    if (signal?.aborted) {
        abortHandler();
    } else {
        signal?.addEventListener('abort', abortHandler);
    }

    proc.stdout.on('data', (d: Buffer) => {
        buf += d.toString('utf-8');
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
            if (line) lines.push(line);
        }
        if (lines.length >= MAX_BUFFER) proc.stdout.pause();
        wake();
    });

    proc.stdout.on('end', () => {
        if (buf) lines.push(buf);
        buf = '';
        done = true;
        wake();
    });

    proc.on('error', () => {
        errored = true;
        done = true;
        wake();
    });

    proc.on('close', () => {
        // Defensive: ensures we exit even if 'end' was missed (severed pipe, abrupt kill).
        done = true;
        closeResolve();
        wake();
    });

    try {
        let isFirst = true;
        let current: string[] = [];
        let count = 0;

        while (true) {
            while (lines.length > 0) {
                if (signal?.aborted) return;
                current.push(lines.shift()!);
                count++;

                if (current.length >= chunkSize(isFirst, count)) {
                    yield current;
                    isFirst = false;
                    current = [];
                    if (lines.length < MAX_BUFFER / 2) proc.stdout.resume();
                }

                if (maxResults && count >= maxResults) {
                    if (current.length > 0) yield current;
                    proc.kill();
                    await closePromise;
                    return;
                }
            }

            if (done) break;

            await new Promise<void>((res) => {
                resolveNext = res;
            });
        }

        if (current.length > 0) yield current;
        await closePromise;
        if (errored && count === 0) throw new Error(`${cmd} failed`);
    } finally {
        signal?.removeEventListener('abort', abortHandler);
        if (!proc.killed) proc.kill();
    }
}
