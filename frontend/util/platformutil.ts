// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

export const PlatformMacOS = "darwin";
export const PlatformWindows = "win32";
export let PLATFORM: NodeJS.Platform = PlatformMacOS;

export function setPlatform(platform: NodeJS.Platform) {
    PLATFORM = platform;
}

export function isMacOS(): boolean {
    return PLATFORM == PlatformMacOS;
}

export function isWindows(): boolean {
    return PLATFORM == PlatformWindows;
}

/**
 * True on Linux and any other platform that is neither macOS nor Windows.
 *
 * Layout code used to treat "not macOS" as "Windows", which was harmless while
 * Electron drew the window controls on every platform. Under the Tauri shell the
 * frontend draws them on Linux too, so Linux needs the same space reserved that
 * Windows does — and getting that from a negation is how it ended up with 6px.
 */
export function isLinux(): boolean {
    return !isMacOS() && !isWindows();
}

export function makeNativeLabel(isDirectory: boolean) {
    let managerName: string;
    if (!isDirectory) {
        managerName = "Default Application";
    } else if (PLATFORM === PlatformMacOS) {
        managerName = "Finder";
    } else if (PLATFORM == PlatformWindows) {
        managerName = "Explorer";
    } else {
        managerName = "File Manager";
    }

    let fileAction: string;
    if (isDirectory) {
        fileAction = "Reveal";
    } else {
        fileAction = "Open File";
    }
    return `${fileAction} in ${managerName}`;
}
