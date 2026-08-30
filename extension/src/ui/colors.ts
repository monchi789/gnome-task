import type {GroupColor} from '@gnome-task/domain';

/**
 * The eight group colours, as the shell can actually draw them.
 *
 * These are the libadwaita named palette, written out here rather than in
 * `stylesheet.css` because the shell's CSS subset has no variables and no
 * `currentColor`: a class per colour would have to repeat itself for the dot,
 * the swatch and the row stripe, and would paint whole rows by accident. One
 * inline `style` string is both smaller and harder to get wrong.
 */
const HEX: Record<GroupColor, string> = {
    blue: '#3584e4',
    green: '#2ec27e',
    yellow: '#f5c211',
    orange: '#ff7800',
    red: '#e01b24',
    purple: '#9141ac',
    brown: '#986a44',
    gray: '#77767b',
};

export function colorHex(color: GroupColor): string {
    return HEX[color];
}

/** The filled circle on a header and in the palette. */
export function dotStyle(color: GroupColor): string {
    return `background-color: ${HEX[color]};`;
}

/** The stripe down the left edge of a task that belongs to a group. */
export function stripeStyle(color: GroupColor): string {
    return `border-left: 3px solid ${HEX[color]};`;
}
