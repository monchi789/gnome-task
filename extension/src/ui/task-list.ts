import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {GroupColor, Section, Task} from '@gnome-task/domain';
import {isCompleted} from '@gnome-task/domain';

import type {DragHandlers} from './drag.ts';
import type {GroupHandlers} from './group-header.ts';
import type {TaskItemHandlers} from './task-item.ts';
import {ColorPaletteRow, GroupHeaderItem} from './group-header.ts';
import {DragController} from './drag.ts';
import {EntryRow} from './entry-row.ts';
import {TaskItem} from './task-item.ts';

/** Roughly one popup row; used to turn a row count into a pixel cap. */
const ROW_HEIGHT_PX = 36;

export interface TaskListOptions {
    showCompleted: boolean;
    maxVisibleTasks: number;
}

/** The transient bits of UI state that must survive a rebuild. */
export interface ListUiState {
    /** Task or group being renamed inline. */
    readonly editingId: string | null;
    /** Group whose "new task" entry is open. */
    readonly composingGroupId: string | null;
    /** Group whose colour palette is unfolded. */
    readonly paletteGroupId: string | null;
}

export interface ListHandlers {
    readonly task: TaskItemHandlers;
    readonly group: GroupHandlers;
    readonly drag: DragHandlers;
    onAddTaskToGroup(groupId: string, title: string): void;
}

/**
 * The scrollable list of sections plus its empty state.
 *
 * Rebuilds wholesale on every change. That is cheap at this scale and avoids a
 * whole class of stale-widget bugs; the transient UI state worth preserving
 * across a rebuild — which row is being edited, which group is composing or
 * showing its palette — is handed back by the owner through `ListUiState`.
 */
export class TaskListView {
    readonly #section = new PopupMenu.PopupMenuSection();
    readonly #scrollView: St.ScrollView;
    readonly #handlers: ListHandlers;
    readonly #drag: DragController;

    #options: TaskListOptions;

    constructor(handlers: ListHandlers, options: TaskListOptions) {
        this.#handlers = handlers;
        this.#options = options;

        this.#scrollView = new St.ScrollView({
            style_class: 'gnome-task-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            child: this.#section.actor,
        });
        this.#drag = new DragController(this.#scrollView, handlers.drag);
        this.#applyHeightCap();
    }

    get actor(): St.ScrollView {
        return this.#scrollView;
    }

    setOptions(options: TaskListOptions): void {
        this.#options = options;
        this.#applyHeightCap();
    }

    /** Rebuild every row from the current sections. */
    render(sections: readonly Section[], ui: ListUiState): void {
        // Order matters: the drag controller tracks actors this is about to
        // destroy, so it has to let go before they go away.
        this.#drag.reset();
        this.#section.removeAll();

        if (sections.length === 0) {
            this.#addEmptyState('No tasks yet — add one below');
            return;
        }

        let visibleTasks = 0;
        let composer: EntryRow | null = null;

        for (const section of sections) {
            const group = section.group;
            const tasks = this.#visibleTasks(section.tasks);
            visibleTasks += tasks.length;

            if (group !== null) {
                const header = new GroupHeaderItem(
                    group,
                    section.tasks.filter((task) => !isCompleted(task)).length,
                    this.#handlers.group,
                    this.#drag,
                );
                this.#section.addMenuItem(header);
                if (group.id === ui.editingId) header.startEditing();

                if (group.id === ui.paletteGroupId) {
                    this.#section.addMenuItem(
                        new ColorPaletteRow(group, (color: GroupColor) =>
                            this.#handlers.group.onRecolor(group.id, color),
                        ),
                    );
                }

                if (group.collapsed) continue;
            }

            for (const task of tasks) {
                const item = new TaskItem(
                    task,
                    group?.color ?? null,
                    this.#handlers.task,
                    this.#drag,
                );
                this.#section.addMenuItem(item);
                if (task.id === ui.editingId) item.startEditing();
            }

            if (group !== null && group.id === ui.composingGroupId) {
                composer = new EntryRow({
                    iconName: 'list-add-symbolic',
                    hint: `New task in ${group.title}…`,
                    styleClass: 'gnome-task-new-row gnome-task-group-compose',
                    onSubmit: (title) => this.#handlers.onAddTaskToGroup(group.id, title),
                    onCancel: () => this.#handlers.group.onCompose(group.id),
                });
                this.#section.addMenuItem(composer);
            }
        }

        // With groups on screen there is always something to look at; only a
        // bare inbox with everything filtered out needs a placeholder.
        if (visibleTasks === 0 && sections.every((section) => section.group === null)) {
            this.#addEmptyState('Nothing pending');
        }

        // The entry is destroyed and rebuilt by every render, so the caret has
        // to be put back after the one that follows a submission.
        composer?.focusEntry();
    }

    destroy(): void {
        this.#drag.destroy();
        this.#scrollView.destroy();
    }

    #addEmptyState(text: string): void {
        const empty = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            can_focus: false,
            style_class: 'gnome-task-empty',
        });
        empty.add_child(
            new St.Label({text, x_expand: true, style_class: 'gnome-task-empty-label'}),
        );
        this.#section.addMenuItem(empty);
    }

    #visibleTasks(tasks: readonly Task[]): readonly Task[] {
        return this.#options.showCompleted ? tasks : tasks.filter((task) => !isCompleted(task));
    }

    #applyHeightCap(): void {
        this.#scrollView.style = `max-height: ${this.#options.maxVisibleTasks * ROW_HEIGHT_PX}px;`;
    }
}
