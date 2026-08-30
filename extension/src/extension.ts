import type Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TaskService} from './application/task-service.ts';
import {JsonTaskRepository} from './infrastructure/storage/json-task-repository.ts';
import {resolveTaskFilePath} from './infrastructure/storage/task-file.ts';
import {TaskIndicator} from './ui/indicator.ts';

export default class GnomeTaskExtension extends Extension {
    #indicator: TaskIndicator | null = null;
    #service: TaskService | null = null;
    #settings: Gio.Settings | null = null;
    #storageSignalId = 0;

    override enable(): void {
        const settings = this.getSettings();
        this.#settings = settings;

        // The settings object outlives the UI on purpose: pointing the
        // extension at another file tears the UI down and builds it again, and
        // this handler has to survive that.
        this.#storageSignalId = settings.connect('changed::storage-file', () => {
            this.#tearDownUi();
            this.#buildUi();
        });

        this.#buildUi();
    }

    override disable(): void {
        // The shell also calls disable() for the lock screen, so this runs
        // often and must leave nothing behind: a surviving actor shows up as a
        // duplicate indicator the next time enable() runs, and a live timer
        // keeps the whole extension alive after unload.
        this.#tearDownUi();

        if (this.#storageSignalId > 0) {
            this.#settings?.disconnect(this.#storageSignalId);
            this.#storageSignalId = 0;
        }
        this.#settings = null;
    }

    /**
     * Build the repository, the service and the indicator, in that order.
     *
     * Everything downstream of the file path is rebuilt together: a
     * `TaskService` owns its repository for its whole life and a
     * `TaskIndicator` captures the service at construction, so swapping the
     * repository underneath either one would be the fragile option.
     */
    #buildUi(): void {
        const settings = this.#settings;
        if (settings === null) return;

        const repository = new JsonTaskRepository(
            resolveTaskFilePath(settings.get_string('storage-file')),
        );
        const service = new TaskService(repository);
        this.#service = service;

        this.#indicator = new TaskIndicator({
            service,
            settings,
            iconPath: `${this.path}/icons/gnome-task-symbolic.svg`,
            openPreferences: () => this.openPreferences(),
        });
        Main.panel.addToStatusArea(this.uuid, this.#indicator);

        // Reading from disk is async, so the panel appears immediately and
        // fills in a moment later. `changed` drives the repaint.
        service.load().catch((error: unknown) => {
            console.error(`GNOME Task: could not load stored tasks: ${String(error)}`);
        });
    }

    #tearDownUi(): void {
        this.#indicator?.destroy();
        this.#indicator = null;

        // destroy() flushes a pending write synchronously, so an edit made a
        // moment before a path change still lands in the *old* file — which is
        // what "changing the path moves nothing" has to mean.
        this.#service?.destroy();
        this.#service = null;
    }
}
