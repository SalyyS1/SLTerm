// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import bgpresetsSchema from "../../../schema/bgpresets.json";
import connectionsSchema from "../../../schema/connections.json";
import settingsSchema from "../../../schema/settings.json";
import widgetsSchema from "../../../schema/widgets.json";

type SchemaInfo = {
    uri: string;
    fileMatch: Array<string>;
    schema: object;
};

const MonacoSchemas: SchemaInfo[] = [
    {
        uri: "wave://schema/settings.json",
        fileMatch: ["*/WAVECONFIGPATH/settings.json"],
        schema: settingsSchema,
    },
    {
        uri: "wave://schema/connections.json",
        fileMatch: ["*/WAVECONFIGPATH/connections.json"],
        schema: connectionsSchema,
    },
    {
        uri: "wave://schema/bgpresets.json",
        fileMatch: ["*/WAVECONFIGPATH/presets/bg.json"],
        schema: bgpresetsSchema,
    },
    {
        uri: "wave://schema/widgets.json",
        fileMatch: ["*/WAVECONFIGPATH/widgets.json"],
        schema: widgetsSchema,
    },
];

export { MonacoSchemas };
