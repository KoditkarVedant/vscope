/**
 * Yield slices of `arr` as an async generator, awaiting between chunks so the
 * event loop can drain pending tasks (incoming messages, keypresses). Used to
 * smooth re-emit of large in-memory result sets so the consumer doesn't see a
 * burst of N synchronous postMessages.
 */
export async function* chunkArray<T>(
    arr: readonly T[],
    chunkSize: number,
    signal?: AbortSignal
): AsyncGenerator<T[]> {
    for (let i = 0; i < arr.length; i += chunkSize) {
        if (signal?.aborted) return;
        yield arr.slice(i, i + chunkSize) as T[];
        if (i + chunkSize < arr.length) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
    }
}
