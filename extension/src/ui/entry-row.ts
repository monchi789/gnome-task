import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export interface EntryRowOptions {
    readonly iconName: string;
    readonly hint: string;
    readonly styleClass?: string;
    onSubmit(text: string): void;
    /** Escape, or losing focus with nothing typed. Absent means "stay put". */
    onCancel?(): void;
}

/**
 * A one-line "type something and press Enter" row.
 *
 * Used three ways: the permanent new-task row at the bottom of the popup, the
 * new-task row a group opens inside itself, and the new-group row. Enter
 * submits and clears the field without closing the menu or dropping focus, so
 * several entries can be typed in a row.
 */
export class EntryRow extends PopupMenu.PopupBaseMenuItem {
    static {
        GObject.registerClass(this);
    }

    readonly #entry: St.Entry;
    readonly #options: EntryRowOptions;

    constructor(options: EntryRowOptions) {
        super({
            activate: false,
            can_focus: false,
            style_class: options.styleClass ?? 'gnome-task-new-row',
        });
        this.#options = options;

        this.add_child(
            new St.Icon({
                icon_name: options.iconName,
                style_class: 'popup-menu-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );

        this.#entry = new St.Entry({
            hint_text: options.hint,
            style_class: 'gnome-task-entry',
            x_expand: true,
            can_focus: true,
        });
        this.#entry.clutter_text.connect('activate', () => this.#submit());
        this.#entry.connect('key-press-event', (_actor, event: Clutter.Event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.#options.onCancel?.();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.add_child(this.#entry);
    }

    focusEntry(): void {
        this.#entry.grab_key_focus();
    }

    #submit(): void {
        const text = this.#entry.text;
        if (text.trim() === '') return;

        this.#entry.text = '';
        this.#options.onSubmit(text);
        // Submitting rebuilds the list. A row that lives *inside* the list is
        // destroyed by that rebuild and refocused by the new one; the
        // permanent row at the bottom survives and keeps the caret here, so
        // the next entry can be typed straight away.
        if (this.#entry.get_stage() !== null) this.#entry.grab_key_focus();
    }
}
