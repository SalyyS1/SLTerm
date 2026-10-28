import { ProofError } from "./proof-errors.ts";

/** Stop awaiting a stuck SDK iterator after host cancellation, even before SDK cleanup settles. */
export function cancelableNext<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
    return new Promise((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener("abort", abort);
            reject(new ProofError("RUN_CANCELLED"));
        };
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve().then(() => iterator.next()).then(resolve, reject).finally(() => {
            signal.removeEventListener("abort", abort);
        });
    });
}
