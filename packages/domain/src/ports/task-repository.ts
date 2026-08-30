import type {Board} from '../board.ts';

/**
 * The only door between the application layer and storage.
 *
 * Today the implementation is a JSON file (`JsonTaskRepository`). In phase 5
 * an encrypted-vault implementation takes its place, and no UI code changes.
 */
export interface TaskRepository {
    load(): Promise<Board>;
    save(board: Board): Promise<void>;
}
