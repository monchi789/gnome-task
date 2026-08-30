import type {DomainContext} from '../src/task.ts';

/**
 * A deterministic context: the clock advances one second per read and ids are
 * sequential, so assertions can name exact values instead of matching shapes.
 */
export function testContext(startMs = Date.UTC(2026, 0, 1)): DomainContext & {tick(): void} {
    let ms = startMs;
    let counter = 0;
    return {
        clock: {
            now(): string {
                const iso = new Date(ms).toISOString();
                ms += 1000;
                return iso;
            },
        },
        ids: {
            next(): string {
                counter += 1;
                return `task-${counter}`;
            },
        },
        tick(): void {
            ms += 1000;
        },
    };
}
