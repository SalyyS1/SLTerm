import { UserConfig, configDefaults, defineConfig, mergeConfig } from "vitest/config";
import electronViteConfig from "./electron.vite.config";

export default mergeConfig(
    electronViteConfig.renderer as UserConfig,
    defineConfig({
        test: {
            // These suites use node:test (and the provider's isolated TS loader).
            // Run them through test:proof-tools / test:provider-proof instead.
            exclude: [...configDefaults.exclude, "scripts/terminal-proof/**/*.test.mjs", "scripts/provider-proof/**/*.test.mjs"],
            reporters: ["verbose", "junit"],
            outputFile: {
                junit: "test-results.xml",
            },
            coverage: {
                provider: "istanbul",
                reporter: ["lcov"],
                reportsDirectory: "./coverage",
            },
            typecheck: {
                tsconfig: "tsconfig.json",
            },
        },
    })
);
