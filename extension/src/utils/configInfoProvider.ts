import * as vscode from 'vscode';
import { AspireTerminalProvider } from './AspireTerminalProvider';
import { spawnCliProcess } from '../debugger/languages/cli';
import { extensionLogOutputChannel } from './logging';
import { ConfigInfo, FeatureInfo, PropertyInfo, SettingsSchema } from '../types/configInfo';
import * as strings from '../loc/strings';

type RawFeatureInfo = Partial<FeatureInfo> & {
    name?: unknown;
    description?: unknown;
    defaultValue?: unknown;
};

type RawPropertyInfo = Partial<PropertyInfo> & {
    name?: unknown;
    type?: unknown;
    description?: unknown;
    required?: unknown;
    subProperties?: unknown;
    additionalPropertiesType?: unknown;
};

type RawSettingsSchema = Partial<SettingsSchema> & {
    properties?: unknown;
};

type RawConfigInfo = Partial<ConfigInfo> & {
    localSettingsPath?: unknown;
    globalSettingsPath?: unknown;
    availableFeatures?: unknown;
    localSettingsSchema?: unknown;
    globalSettingsSchema?: unknown;
    configFileSchema?: unknown;
    capabilities?: unknown;
};

/**
 * Gets configuration information from the Aspire CLI.
 */
export async function getConfigInfo(terminalProvider: AspireTerminalProvider): Promise<ConfigInfo | null> {
    const cliPath = await terminalProvider.getAspireCliExecutablePath();
    const workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    return new Promise<ConfigInfo | null>((resolve) => {
        const args = ['config', 'info', '--json'];
        let output = '';

        spawnCliProcess(terminalProvider, cliPath, args, {
            stdoutCallback: (data) => {
                output += data;
            },
            stderrCallback: (data) => {
                extensionLogOutputChannel.error(`aspire config info stderr: ${data}`);
            },
            exitCallback: (code) => {
                if (code !== 0) {
                    extensionLogOutputChannel.error(strings.failedToGetConfigInfo(code ?? -1));
                    vscode.window.showErrorMessage(strings.failedToGetConfigInfo(code ?? -1));
                    resolve(null);
                    return;
                }

                try {
                    const configInfo = parseConfigInfoOutput(output);
                    extensionLogOutputChannel.info(`Got config info: ${configInfo.AvailableFeatures.length} features available`);
                    resolve(configInfo);
                } catch (error) {
                    extensionLogOutputChannel.error(strings.failedToParseConfigInfo(error));
                    vscode.window.showErrorMessage(strings.failedToParseConfigInfo(error));
                    resolve(null);
                }
            },
            errorCallback: (error) => {
                extensionLogOutputChannel.error(strings.errorGettingConfigInfo(error));
                vscode.window.showErrorMessage(strings.errorGettingConfigInfo(error));
                resolve(null);
            },
            workingDirectory,
            noExtensionVariables: true
        });
    });
}

export function parseConfigInfoOutput(output: string): ConfigInfo {
    const configInfo = JSON.parse(output.trim()) as RawConfigInfo;

    return {
        LocalSettingsPath: readString(configInfo.LocalSettingsPath ?? configInfo.localSettingsPath, 'localSettingsPath'),
        GlobalSettingsPath: readString(configInfo.GlobalSettingsPath ?? configInfo.globalSettingsPath, 'globalSettingsPath'),
        AvailableFeatures: readArray(configInfo.AvailableFeatures ?? configInfo.availableFeatures, 'availableFeatures').map(normalizeFeatureInfo),
        LocalSettingsSchema: normalizeSettingsSchema(configInfo.LocalSettingsSchema ?? configInfo.localSettingsSchema, 'localSettingsSchema'),
        GlobalSettingsSchema: normalizeSettingsSchema(configInfo.GlobalSettingsSchema ?? configInfo.globalSettingsSchema, 'globalSettingsSchema'),
        ConfigFileSchema: normalizeOptionalSettingsSchema(configInfo.ConfigFileSchema ?? configInfo.configFileSchema, 'configFileSchema'),
        Capabilities: normalizeOptionalStringArray(configInfo.Capabilities ?? configInfo.capabilities, 'capabilities'),
    };
}

function normalizeFeatureInfo(value: unknown): FeatureInfo {
    const feature = readObject<RawFeatureInfo>(value, 'availableFeatures[]');

    return {
        Name: readString(feature.Name ?? feature.name, 'availableFeatures[].name'),
        Description: readString(feature.Description ?? feature.description, 'availableFeatures[].description'),
        DefaultValue: readBoolean(feature.DefaultValue ?? feature.defaultValue, 'availableFeatures[].defaultValue'),
    };
}

function normalizeSettingsSchema(value: unknown, propertyName: string): SettingsSchema {
    const schema = readObject<RawSettingsSchema>(value, propertyName);

    return {
        Properties: readArray(schema.Properties ?? schema.properties, `${propertyName}.properties`).map(normalizePropertyInfo),
    };
}

function normalizeOptionalSettingsSchema(value: unknown, propertyName: string): SettingsSchema | undefined {
    if (value === undefined) {
        return undefined;
    }

    return normalizeSettingsSchema(value, propertyName);
}

function normalizePropertyInfo(value: unknown): PropertyInfo {
    const property = readObject<RawPropertyInfo>(value, 'properties[]');
    const subProperties = property.SubProperties ?? property.subProperties;
    const additionalPropertiesType = property.AdditionalPropertiesType ?? property.additionalPropertiesType;

    return {
        Name: readString(property.Name ?? property.name, 'properties[].name'),
        Type: readString(property.Type ?? property.type, 'properties[].type'),
        Description: readString(property.Description ?? property.description, 'properties[].description'),
        Required: readBoolean(property.Required ?? property.required, 'properties[].required'),
        ...(subProperties === undefined ? {} : { SubProperties: readArray(subProperties, 'properties[].subProperties').map(normalizePropertyInfo) }),
        ...(additionalPropertiesType === undefined ? {} : { AdditionalPropertiesType: readString(additionalPropertiesType, 'properties[].additionalPropertiesType') }),
    };
}

function normalizeOptionalStringArray(value: unknown, propertyName: string): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }

    return readArray(value, propertyName).map(item => readString(item, `${propertyName}[]`));
}

function readObject<T extends object>(value: unknown, propertyName: string): T {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as T;
    }

    throw new Error(`Expected ${propertyName} to be an object.`);
}

function readArray(value: unknown, propertyName: string): unknown[] {
    if (Array.isArray(value)) {
        return value;
    }

    throw new Error(`Expected ${propertyName} to be an array.`);
}

function readString(value: unknown, propertyName: string): string {
    if (typeof value === 'string') {
        return value;
    }

    throw new Error(`Expected ${propertyName} to be a string.`);
}

function readBoolean(value: unknown, propertyName: string): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    throw new Error(`Expected ${propertyName} to be a boolean.`);
}
