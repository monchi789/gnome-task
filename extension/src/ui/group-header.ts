import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {GroupColor, Step, TaskGroup} from '@gnome-task/domain';
import {GROUP_COLORS} from '@gnome-task/domain';

import type {DragController} from './drag.ts';
import {dotStyle} from './colors.ts';
import {handleMoveKeys} from './keys.ts';

export interface GroupHandlers {
    onToggleCollapsed(id: string): void;
    onRename(id: string, title: string): void;
    onRecolor(id: string, color: GroupColor): void;
    onRemove(id: string): void;
    /** Show or hide the colour palette under this header. */
    onTogglePalette(id: string): void;
    /** Open the "new task in this group" entry. */
    onCompose(id: string): void;
    /** Ctrl+Up / Ctrl+Down: the keyboard path to reordering. */
    onMove(id: string, step: Step): void;
    /** Called when this header enters or leaves inline editing. */
    onEditingChanged(id: string, editing: boolean): void;
}

/**
 * One group header: grip, fold arrow, colour dot, title, count, add, delete.
 *
 * Built with `activate: false` for the same reason as `TaskItem` — an
 * activatable row makes the shell close the whole menu on click, and folding a
 * group must leave the popup open.
 */
export class GroupHeaderItem extends PopupMenu.PopupBaseMenuItem {
    static {
        GObject.registerClass(this);
    }

    readonly #group: TaskGroup;
    readonly #handlers: GroupHandlers;
    readonly #titleButton: St.Button;
    readonly #entry: St.Entry;

    #editing = false;

    constructor(group: TaskGroup, pending: number, handlers: GroupHandlers, drag: DragController) {
        super({activate: false, can_focus: false, style_class: 'gnome-task-group-header'});

        this.#group = group;
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
            kind: 'group',
            id: group.id,
            groupId: group.id,
            actor: this,
            collapsed: group.collapsed,
        });
        this.add_child(grip);

        const fold = new St.Button({
            style_class: 'gnome-task-fold',
            child: new St.Icon({
                icon_name: group.collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic',
                style_class: 'popup-menu-icon',
            }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        fold.connect('clicked', () => {
            this.#handlers.onToggleCollapsed(this.#group.id);
            return Clutter.EVENT_STOP;
        });
        this.add_child(fold);

        const dot = new St.Button({
            style_class: 'gnome-task-group-dot',
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            child: new St.Widget({
                style_class: 'gnome-task-group-dot-fill',
                style: dotStyle(group.color),
            }),
        });
        dot.connect('clicked', () => {
            this.#handlers.onTogglePalette(this.#group.id);
            return Clutter.EVENT_STOP;
        });
        this.add_child(dot);

        const label = new St.Label({
            text: group.title,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'gnome-task-group-title',
        });
        label.clutter_text.set_line_wrap(false);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        this.#titleButton = new St.Button({
            style_class: 'gnome-task-title-button',
            child: label,
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
            text: group.title,
            style_class: 'gnome-task-entry',
            x_expand: true,
            visible: false,
            can_focus: true,
        });
        this.#entry.clutter_text.connect('activate', () => this.#commitEdit());
        this.#entry.clutter_text.connect('key-focus-out', () => {
            if (this.#editing) this.#commitEdit();
        });
        this.#entry.connect('key-press-event', (_actor, event: Clutter.Event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.#stopEditing();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.add_child(this.#entry);

        this.add_child(
            new St.Label({
                text: String(pending),
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'gnome-task-group-count',
                visible: pending > 0,
            }),
        );

        this.add_child(
            iconButton('list-add-symbolic', 'gnome-task-group-add', () =>
                this.#handlers.onCompose(this.#group.id),
            ),
        );
        this.add_child(
            iconButton('user-trash-symbolic', 'gnome-task-delete', () =>
                this.#handlers.onRemove(this.#group.id),
            ),
        );

        this.connect('key-press-event', (_actor, event: Clutter.Event) =>
            handleMoveKeys(event, (step) => this.#handlers.onMove(this.#group.id, step)),
        );
    }

    get groupId(): string {
        return this.#group.id;
    }

    startEditing(): void {
        if (this.#editing) return;
        this.#editing = true;

        this.#entry.text = this.#group.title;
        this.#titleButton.visible = false;
        this.#entry.visible = true;
        this.#entry.grab_key_focus();
        this.#entry.clutter_text.set_selection(0, this.#group.title.length);

        this.#handlers.onEditingChanged(this.#group.id, true);
    }

    #stopEditing(): void {
        if (!this.#editing) return;
        this.#editing = false;
        this.#entry.visible = false;
        this.#titleButton.visible = true;
        this.#handlers.onEditingChanged(this.#group.id, false);
    }

    #commitEdit(): void {
        if (!this.#editing) return;
        const text = this.#entry.text;
        this.#stopEditing();

        // A blank title is a no-op, not a delete: deleting is the trash button.
        if (text.trim() === '' || text === this.#group.title) return;
        this.#handlers.onRename(this.#group.id, text);
    }
}

/** The eight swatches, shown under a header while its dot is toggled on. */
export class ColorPaletteRow extends PopupMenu.PopupBaseMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(group: TaskGroup, onPick: (color: GroupColor) => void) {
        super({activate: false, can_focus: false, style_class: 'gnome-task-palette'});

        for (const color of GROUP_COLORS) {
            const swatch = new St.Button({
                style_class:
                    color === group.color
                        ? 'gnome-task-swatch gnome-task-swatch-active'
                        : 'gnome-task-swatch',
                can_focus: true,
                child: new St.Widget({
                    style_class: 'gnome-task-swatch-fill',
                    style: dotStyle(color),
                }),
            });
            swatch.connect('clicked', () => {
                onPick(color);
                return Clutter.EVENT_STOP;
            });
            this.add_child(swatch);
        }
    }
}

function iconButton(iconName: string, styleClass: string, onClick: () => void): St.Button {
    const button = new St.Button({
        style_class: styleClass,
        child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
    });
    button.connect('clicked', () => {
        onClick();
        return Clutter.EVENT_STOP;
    });
    return button;
}
