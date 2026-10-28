export type ColorToken = "bg" | "surface" | "surfaceRaised" | "surfaceHover" | "text" | "textMuted" | "line" | "accent" | "terminalBg" | "terminalFg" | "selection";
export type AppearancePreset = {
    id: string;
    name: string;
    mode: "dark" | "light";
    colors: Record<ColorToken, string>;
    ansi: Record<string, string>;
};

export function mixHex(first: string, second: string, ratio: number): string {
    const a = Number.parseInt(first.slice(1), 16);
    const b = Number.parseInt(second.slice(1), 16);
    return "#" + [16, 8, 0].map((shift) => Math.round(((a >> shift) & 255) * (1 - ratio) + ((b >> shift) & 255) * ratio).toString(16).padStart(2, "0")).join("");
}

const ansiKeys = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
function preset(id: string, name: string, mode: "dark" | "light", bg: string, fg: string, accent: string, palette: string[]): AppearancePreset {
    const light = mode === "light";
    const toward = light ? "#ffffff" : fg;
    return {
        id, name, mode,
        colors: {
            bg, surface: mixHex(bg, toward, light ? .65 : .035), surfaceRaised: mixHex(bg, toward, light ? .9 : .065),
            surfaceHover: mixHex(bg, fg, .1), text: fg, textMuted: mixHex(fg, bg, .3),
            line: mixHex(bg, fg, .2), accent, terminalBg: bg, terminalFg: fg, selection: mixHex(bg, accent, .3),
        },
        ansi: Object.fromEntries(ansiKeys.flatMap((key, index) => [[key, palette[index]], ["bright" + key[0].toUpperCase() + key.slice(1), mixHex(palette[index], light ? "#000000" : "#ffffff", .2)]])),
    };
}

/** Fully local palettes: no network fonts or theme downloads. */
export const appearancePresets: AppearancePreset[] = [
    preset("slterm-dark", "SLTerm Dark", "dark", "#0b0f15", "#d4dce9", "#7bc4ba", ["#18212d", "#e99691", "#a7c993", "#e2c087", "#89b4da", "#c1a0d8", "#7bc4ba", "#d4dce9"]),
    preset("slterm-light", "SLTerm Light", "light", "#f1f4f6", "#243447", "#286d64", ["#243447", "#a13f3a", "#357246", "#8b6424", "#326fa6", "#8156a4", "#287b80", "#c9d1da"]),
    preset("dracula", "Dracula", "dark", "#282a36", "#f8f8f2", "#bd93f9", ["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2"]),
    preset("nord", "Nord", "dark", "#2e3440", "#d8dee9", "#88c0d0", ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0"]),
    preset("tokyo-night", "Tokyo Night", "dark", "#1a1b26", "#c0caf5", "#7aa2f7", ["#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"]),
    preset("gruvbox", "Gruvbox", "dark", "#282828", "#ebdbb2", "#fabd2f", ["#3c3836", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2"]),
    preset("catppuccin", "Catppuccin Mocha", "dark", "#1e1e2e", "#cdd6f4", "#cba6f7", ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de"]),
    preset("everforest", "Everforest", "dark", "#2d353b", "#d3c6aa", "#a7c080", ["#475258", "#e67e80", "#a7c080", "#dbbc7f", "#7fbbb3", "#d699b6", "#83c092", "#d3c6aa"]),
    preset("rose-pine", "Rosé Pine", "dark", "#191724", "#e0def4", "#ebbcba", ["#26233a", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4"]),
    preset("solarized-light", "Solarized Light", "light", "#fdf6e3", "#586e75", "#268bd2", ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5"]),
    preset("paper", "Paper", "light", "#fffef8", "#343434", "#426b95", ["#343434", "#a83a32", "#47743b", "#8a6500", "#426b95", "#825a91", "#287a7a", "#d9d8d0"]),
    preset("rose-dawn", "Rosé Dawn", "light", "#faf4ed", "#575279", "#b4637a", ["#575279", "#b4637a", "#56949f", "#aa7c32", "#286983", "#907aa9", "#577a76", "#dfdad9"]),
];
