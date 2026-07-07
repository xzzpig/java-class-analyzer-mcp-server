export type ToolArguments = Record<string, unknown>;

export function asToolArguments(rawArguments: unknown): ToolArguments {
    if (typeof rawArguments !== 'object' || rawArguments === null) {
        return {};
    }

    return Object.fromEntries(Object.entries(rawArguments));
}

export function readRequiredString(argumentsMap: ToolArguments, key: string): string {
    const value = argumentsMap[key];
    if (typeof value !== 'string') {
        throw new Error(`${key} must be a string.`);
    }
    return value;
}

export function readOptionalString(argumentsMap: ToolArguments, key: string): string | undefined {
    const value = argumentsMap[key];
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmedValue = value.trim();
    return trimmedValue === '' ? undefined : trimmedValue;
}

export function readOptionalBoolean(argumentsMap: ToolArguments, key: string): boolean | undefined {
    const value = argumentsMap[key];
    return typeof value === 'boolean' ? value : undefined;
}

export function readOptionalInteger(argumentsMap: ToolArguments, key: string): number | undefined {
    const value = argumentsMap[key];
    return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}
