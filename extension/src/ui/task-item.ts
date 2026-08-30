import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {GroupColor, Step, Task} from '@gnome-task/domain';
import {isCompleted} from '@gnome-task/domain';

import type {DragController} from './drag.ts';
import {stripeStyle} from './colors.ts';
import {handleMoveKeys} from './keys.ts';

export interface TaskItemHandlers {
    onToggle(id: string): void;
    onRename(id: string, title: string): void;
    onRemove(id: string): void;
    /** Ctrl+Up / Ctrl+Down: the keyboard path to reordering. */
    onMove(id: string, step: Step): void;
    /** Called when this row enters or leaves inline editing. */
    onEditingChanged(id: string, editing: boolean): void;
}

/**
 * One task row: grip, checkbox, title, delete button.
 *
 * Built with `activate: false` on purpose. That flag disables
 * PopupBaseMenuItem's internal ClickAction, which is what would otherwise emit
 * `activate` and make the shell close the whole menu. Ticking a box or
 * deleting a row must leave the popup open, so every interactive part here is
 * a St.Button of our own instead.
 */
export class TaskItem extends PopupMenu.PopupBaseMenuItem {
    static {
        GObject.registerClass(this);
    }

    readonly #task: Task;
    readonly #handlers: TaskItemHandlers;
    readonly #titleButton: St.Button;
    readonly #label: St.Label;
    readonly #entry: St.Entry;

    #editing = false;

    constructor(
        task: Task,
        color: GroupColor | null,
        handlers: TaskItemHandlers,
        drag: DragController,
    ) {
        super({
            activate: false,
            can_focus: false,
            style_class: color === null ? 'gnome-task-item' : 'gnome-task-item gnome-task-grouped',
        });

        // The colour is a stripe down the left edge, so a task keeps saying
        // which group it belongs to while it is being dragged out of one.
        if (color !== null) this.style = stripeStyle(color);

        this.#task = task;
        this.#handlers = handlers;

        // A plain reactive icon, not a button: a button would swallow the
        // press the drag controller needs to see.
        const grip = new St.Icon({
            icon_name: 'list-drag-handle-symbolic',
            style_class: 'popup-menu-icon gnome-task-grip',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true,
        });
        drag.attachHandle(grip, {
            kind: 'task',
            id: task.id,
            groupId: task.projectId,
            actor: this,
        });
        this.add_child(grip);

        const done = isCompleted(task);

        const checkButton = new St.Button({
            style_class: 'gnome-task-check',
            child: new St.Icon({
                icon_name: done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
                style_class: 'popup-menu-icon',
            }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        checkButton.connect('clicked', () => {
            this.#handlers.onToggle(this.#task.id);
            return Clutter.EVENT_STOP;
        });
        this.add_child(checkButton);

        this.#label = new St.Label({
            text: task.title,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: done ? 'gnome-task-title gnome-task-title-done' : 'gnome-task-title',
        });
        this.#label.clutter_text.set_line_wrap(false);
        this.#label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        this.#titleButton = new St.Button({
            style_class: 'gnome-task-title-button',
            child: this.#label,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            can_focus: true,
        });
        this.#titleButton.connect('clicked', () => {
            this.startEditing();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this.#titleButton);

        this.#entry = new St.Entry({
            text: task.title,
            style_class: 'gnome-task-entry',
            x_expand: true,
            visible: false,
            can_focus: true,
        });
        this.#entry.clutter_text.connect('activate', () => this.#commitEdit());
        // Losing focus is a confirm, not a cancel: clicking elsewhere after
        // typing should not silently throw the edit away.
        this.#entry.clutter_text.connect('key-focus-out', () => {
            if (this.#editing) this.#commitEdit();
        });
        this.#entry.connect('key-press-event', (_actor, event: Clutter.Event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.#cancelEdit();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.add_child(this.#entry);

        const deleteButton = new St.Button({
            style_class: 'gnome-task-delete',
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style_class: 'popup-menu-icon',
            }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        deleteButton.connect('clicked', () => {
            this.#handlers.onRemove(this.#task.id);
            return Clutter.EVENT_STOP;
        });
        this.add_child(deleteButton);

        this.connect('key-press-event', (_actor, event: Clutter.Event) =>
            handleMoveKeys(event, (step) => this.#handlers.onMove(this.#task.id, step)),
        );
    }

    get taskId(): string {
        return this.#task.id;
    }

    startEditing(): void {
        if (this.#editing) return;
        this.#editing = true;

        this.#entry.text = this.#task.title;
        this.#titleButton.visible = false;
        this.#entry.visible = true;
        this.#entry.grab_key_focus();
        this.#entry.clutter_text.set_selection(0, this.#task.title.length);

        this.#handlers.onEditingChanged(this.#task.id, true);
    }

    #stopEditing(): void {
        if (!this.#editing) return;
        this.#editing = false;
        this.#entry.visible = false;
        this.#titleButton.visible = true;
        this.#handlers.onEditingChanged(this.#task.id, false);
    }

    #commitEdit(): void {
        if (!this.#editing) return;
        const text = this.#entry.text;
        this.#stopEditing();

        // A blank title is a no-op, not a delete: deleting is the trash button.
        if (text.trim() === '' || text === this.#task.title) return;
        this.#handlers.onRename(this.#task.id, text);
    }

    #cancelEdit(): void {
        this.#stopEditing();
    }
}
