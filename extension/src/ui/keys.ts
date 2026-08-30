import Clutter from 'gi://Clutter';

import type {Step} from '@gnome-task/domain';

/**
 * Ctrl+Up / Ctrl+Down on a focused row.
 *
 * Reordering has to be reachable without a pointer, and this is also the
 * escape hatch if a drag ever misbehaves on someone's setup.
 */
export function handleMoveKeys(event: Clutter.Event, move: (step: Step) => void): boolean {
    if ((event.get_state() & Clutter.ModifierType.CONTROL_MASK) === 0) {
        return Clutter.EVENT_PROPAGATE;
    }

    const symbol = event.get_key_symbol();
    if (symbol === Clutter.KEY_Up) {
        move(-1);
        return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Down) {
        move(1);
        return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
}
