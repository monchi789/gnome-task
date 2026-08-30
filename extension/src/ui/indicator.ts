import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {GroupColor, Step, TaskDropTarget} from '@gnome-task/domain';
import {groupAnchorForStep, taskTargetForStep} from '@gnome-task/domain';

import type {TaskService} from '../application/task-service.ts';
import type {ListHandlers, ListUiState} from './task-list.ts';
import {EntryRow} from './entry-row.ts';
import {TaskListView} from './task-list.ts';

export interface IndicatorDeps {
    service: TaskService;
    settings: Gio.Settings;
    iconPath: string;
    openPreferences: () => void;
}

/**
 * The top-bar button and everything inside its popup.
 *
 * `GObject.registerClass(this)` in a static block registers the type in place
 * and keeps the TypeScript class identity, unlike the older
 * `const X = GObject.registerClass(class ... )` wrapper which erases it.
 */
export class TaskIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    readonly #service: TaskService;
    readonly #settings: Gio.Settings;
    readonly #countLabel: St.Label;
    readonly #list: TaskListView;
    readonly #newTaskRow: EntryRow;
    readonly #newGroupRow: EntryRow;
    readonly #newGroupButton: PopupMenu.PopupBaseMenuItem;

    /** Row currently in inline edit, preserved across list rebuilds. */
    #editingId: string | null = null;
    /** Group with an open "new task" entry, likewise. */
    #composingGroupId: string | null = null;
    /** Group with its colour palette unfolded. */
    #paletteGroupId: string | null = null;
    // Signal ids are namespaced per emitter, so each emitter gets its own
    // slot. Passing a menu id to the service's disconnect() would either throw
    // or silently tear down an unrelated handler.
    #serviceSignalId = 0;
    #menuSignalId = 0;
    #settingsIds: number[] = [];

    constructor(deps: IndicatorDeps) {
        super(0.5, 'GNOME Task', false);

        this.#service = deps.service;
        this.#settings = deps.settings;

        // --- panel button -------------------------------------------------
        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box gnome-task-indicator-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(
            new St.Icon({
                gicon: Gio.icon_new_for_string(deps.iconPath),
                style_class: 'system-status-icon gnome-task-panel-icon',
            }),
        );
        this.#countLabel = new St.Label({
            text: '0',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'gnome-task-count',
            visible: false,
        });
        box.add_child(this.#countLabel);
        this.add_child(box);

        // --- popup contents -----------------------------------------------
        this.#list = new TaskListView(this.#buildHandlers(), this.#readOptions());

        this.#newTaskRow = new EntryRow({
            iconName: 'list-add-symbolic',
            hint: 'New task…',
            onSubmit: (title) => this.#service.addTask({title}),
        });

        this.#newGroupRow = new EntryRow({
            iconName: 'folder-new-symbolic',
            hint: 'Group name…',
            onSubmit: (title) => {
                this.#service.addGroup(title);
                this.#showGroupEntry(false);
            },
            onCancel: () => this.#showGroupEntry(false),
        });
        this.#newGroupRow.visible = false;

        // An ordinary PopupMenuItem would emit `activate` and close the whole
        // popup — the one thing naming a group must not do. Same trick as the
        // task rows: an inert row holding a button of our own.
        this.#newGroupButton = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            can_focus: false,
            style_class: 'gnome-task-new-row',
        });
        const newGroupButton = new St.Button({
            style_class: 'gnome-task-new-group',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            can_focus: true,
            child: new St.BoxLayout({style_class: 'gnome-task-new-group-box'}),
        });
        const newGroupBox = newGroupButton.child as St.BoxLayout;
        newGroupBox.add_child(
            new St.Icon({
                icon_name: 'folder-new-symbolic',
                style_class: 'popup-menu-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        newGroupBox.add_child(
            new St.Label({text: 'New group…', y_align: Clutter.ActorAlign.CENTER}),
        );
        newGroupButton.connect('clicked', () => {
            this.#showGroupEntry(true);
            return Clutter.EVENT_STOP;
        });
        this.#newGroupButton.add_child(newGroupButton);

        const menu = this.menu as PopupMenu.PopupMenu;
        menu.box.add_child(this.#list.actor);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this.#newTaskRow);
        menu.addMenuItem(this.#newGroupButton);
        menu.addMenuItem(this.#newGroupRow);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const clearItem = new PopupMenu.PopupMenuItem('Clear completed');
        clearItem.connect('activate', () => this.#service.clearCompleted());
        menu.addMenuItem(clearItem);

        const prefsItem = new PopupMenu.PopupMenuItem('Preferences');
        prefsItem.connect('activate', () => deps.openPreferences());
        menu.addMenuItem(prefsItem);

        // --- wiring ---------------------------------------------------------
        // The shell's EventEmitter types handlers as returning boolean |
        // undefined (a truthy return stops propagation). `void` makes the
        // arrow return undefined, which is the "keep going" answer.
        this.#serviceSignalId = this.#service.connect('changed', () => void this.refresh());

        // The entry only accepts input once the menu is actually open, so the
        // focus grab has to wait for the open-state change rather than happen
        // at construction time.
        this.#menuSignalId = menu.connect('open-state-changed', (_menu, isOpen: boolean) => {
            if (isOpen) {
                this.#newTaskRow.focusEntry();
            } else {
                this.#editingId = null;
                this.#composingGroupId = null;
                this.#paletteGroupId = null;
                this.#showGroupEntry(false);
                this.refresh();
            }
            return undefined;
        });

        for (const key of ['show-completed', 'show-count-in-panel', 'max-visible-tasks']) {
            this.#settingsIds.push(
                this.#settings.connect(`changed::${key}`, () => {
                    this.#list.setOptions(this.#readOptions());
                    this.refresh();
                }),
            );
        }

        this.refresh();
    }

    refresh(): void {
        const pending = this.#service.pendingCount;

        this.#countLabel.text = String(pending);
        this.#countLabel.visible = this.#settings.get_boolean('show-count-in-panel') && pending > 0;

        this.#list.render(this.#service.sections(), this.#uiState());
    }

    override destroy(): void {
        if (this.#serviceSignalId > 0) {
            this.#service.disconnect(this.#serviceSignalId);
            this.#serviceSignalId = 0;
        }
        if (this.#menuSignalId > 0) {
            (this.menu as PopupMenu.PopupMenu).disconnect(this.#menuSignalId);
            this.#menuSignalId = 0;
        }
        for (const id of this.#settingsIds) this.#settings.disconnect(id);
        this.#settingsIds = [];

        this.#list.destroy();
        super.destroy();
    }

    #uiState(): ListUiState {
        return {
            editingId: this.#editingId,
            composingGroupId: this.#composingGroupId,
            paletteGroupId: this.#paletteGroupId,
        };
    }

    /**
     * Everything the rows can ask for. Reordering is resolved here rather than
     * in the widgets because both paths — a drop and Ctrl+Up/Down — need the
     * sections as currently drawn.
     */
    #buildHandlers(): ListHandlers {
        return {
            task: {
                onToggle: (id) => this.#service.toggleTask(id),
                onRename: (id, title) => this.#service.renameTask(id, title),
                onRemove: (id) => this.#service.removeTask(id),
                onMove: (id, step) => this.#stepTask(id, step),
                onEditingChanged: (id, editing) => this.#setEditing(id, editing),
            },
            group: {
                onToggleCollapsed: (id) => this.#service.toggleGroupCollapsed(id),
                onRename: (id, title) => this.#service.renameGroup(id, title),
                onRecolor: (id, color: GroupColor) => {
                    this.#paletteGroupId = null;
                    this.#service.setGroupColor(id, color);
                    // A colour that is already set is a no-op for the service,
                    // so nothing would repaint and the palette would stay open.
                    this.refresh();
                },
                onRemove: (id) => {
                    if (this.#composingGroupId === id) this.#composingGroupId = null;
                    if (this.#paletteGroupId === id) this.#paletteGroupId = null;
                    this.#service.removeGroup(id);
                },
                onTogglePalette: (id) => {
                    this.#paletteGroupId = this.#paletteGroupId === id ? null : id;
                    this.refresh();
                },
                onCompose: (id) => {
                    this.#composingGroupId = this.#composingGroupId === id ? null : id;
                    this.refresh();
                },
                onMove: (id, step) => this.#stepGroup(id, step),
                onEditingChanged: (id, editing) => this.#setEditing(id, editing),
            },
            drag: {
                onDropTask: (id, target: TaskDropTarget) => this.#service.moveTask(id, target),
                onDropGroup: (id, beforeGroupId) => this.#service.moveGroup(id, beforeGroupId),
            },
            onAddTaskToGroup: (groupId, title) =>
                this.#service.addTask({title, projectId: groupId}),
        };
    }

    #setEditing(id: string, editing: boolean): void {
        this.#editingId = editing ? id : this.#editingId === id ? null : this.#editingId;
    }

    #stepTask(id: string, step: Step): void {
        const target = taskTargetForStep(this.#service.sections(), id, step);
        if (target !== null) this.#service.moveTask(id, target);
    }

    #stepGroup(id: string, step: Step): void {
        const anchor = groupAnchorForStep(this.#service.sections(), id, step);
        if (anchor !== null) this.#service.moveGroup(id, anchor.beforeGroupId);
    }

    #showGroupEntry(open: boolean): void {
        this.#newGroupButton.visible = !open;
        this.#newGroupRow.visible = open;
        if (open) this.#newGroupRow.focusEntry();
    }

    #readOptions() {
        return {
            showCompleted: this.#settings.get_boolean('show-completed'),
            maxVisibleTasks: this.#settings.get_int('max-visible-tasks'),
        };
    }
}
