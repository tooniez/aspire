import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { getConfigInfo, parseConfigInfoOutput } from '../utils/configInfoProvider';
import type { AspireTerminalProvider } from '../utils/AspireTerminalProvider';
import * as cliModule from '../debugger/languages/cli';

suite('configInfoProvider tests', () => {
    teardown(() => sinon.restore());

    test('parseConfigInfoOutput accepts current camel-case CLI JSON', () => {
        const configInfo = parseConfigInfoOutput(JSON.stringify({
            localSettingsPath: '/workspace/aspire.config.json',
            globalSettingsPath: '/home/user/.aspire/aspire.config.json',
            availableFeatures: [
                {
                    name: 'pipelines',
                    description: 'Pipeline support',
                    defaultValue: true,
                },
            ],
            localSettingsSchema: {
                properties: [
                    {
                        name: 'appHost',
                        type: 'object',
                        description: 'AppHost settings',
                        required: false,
                        subProperties: [
                            {
                                name: 'path',
                                type: 'string',
                                description: 'AppHost path',
                                required: true,
                            },
                        ],
                    },
                ],
            },
            globalSettingsSchema: {
                properties: [],
            },
            configFileSchema: {
                properties: [],
            },
            capabilities: ['pipelines'],
        }));

        assert.strictEqual(configInfo.LocalSettingsPath, '/workspace/aspire.config.json');
        assert.strictEqual(configInfo.GlobalSettingsPath, '/home/user/.aspire/aspire.config.json');
        assert.strictEqual(configInfo.AvailableFeatures[0].Name, 'pipelines');
        assert.strictEqual(configInfo.AvailableFeatures[0].DefaultValue, true);
        assert.strictEqual(configInfo.LocalSettingsSchema.Properties[0].Name, 'appHost');
        assert.strictEqual(configInfo.LocalSettingsSchema.Properties[0].SubProperties?.[0].Name, 'path');
        assert.deepStrictEqual(configInfo.Capabilities, ['pipelines']);
    });

    test('parseConfigInfoOutput accepts legacy Pascal-case CLI JSON', () => {
        const configInfo = parseConfigInfoOutput(JSON.stringify({
            LocalSettingsPath: '/workspace/aspire.config.json',
            GlobalSettingsPath: '/home/user/.aspire/aspire.config.json',
            AvailableFeatures: [
                {
                    Name: 'pipelines',
                    Description: 'Pipeline support',
                    DefaultValue: true,
                },
            ],
            LocalSettingsSchema: {
                Properties: [
                    {
                        Name: 'packageSources',
                        Type: 'object',
                        Description: 'Package sources',
                        Required: false,
                        AdditionalPropertiesType: 'string',
                    },
                ],
            },
            GlobalSettingsSchema: {
                Properties: [],
            },
            Capabilities: ['pipelines'],
        }));

        assert.strictEqual(configInfo.LocalSettingsPath, '/workspace/aspire.config.json');
        assert.strictEqual(configInfo.GlobalSettingsPath, '/home/user/.aspire/aspire.config.json');
        assert.strictEqual(configInfo.AvailableFeatures[0].Description, 'Pipeline support');
        assert.strictEqual(configInfo.LocalSettingsSchema.Properties[0].AdditionalPropertiesType, 'string');
        assert.deepStrictEqual(configInfo.Capabilities, ['pipelines']);
    });

    test('getConfigInfo runs in the workspace folder when one is open', async () => {
        const workspaceFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file('/workspace'),
            name: 'workspace',
            index: 0,
        };
        sinon.stub(vscode.workspace, 'workspaceFolders').value([workspaceFolder]);
        const terminalProvider = {
            getAspireCliExecutablePath: async () => '/usr/bin/aspire',
            createEnvironment: () => ({}),
        } as unknown as AspireTerminalProvider;
        let workingDirectory: string | undefined;
        const spawnStub = sinon.stub(cliModule, 'spawnCliProcess').callsFake((_terminalProvider, _command, _args, options) => {
            workingDirectory = options?.workingDirectory;
            options?.stdoutCallback?.(JSON.stringify({
                localSettingsPath: '/workspace/aspire.config.json',
                globalSettingsPath: '/home/user/.aspire/aspire.config.json',
                availableFeatures: [],
                localSettingsSchema: { properties: [] },
                globalSettingsSchema: { properties: [] },
            }));
            options?.exitCallback?.(0);
            return {} as ChildProcessWithoutNullStreams;
        });

        const configInfo = await getConfigInfo(terminalProvider);

        assert.ok(configInfo);
        assert.strictEqual(workingDirectory, workspaceFolder.uri.fsPath);
        assert.strictEqual(spawnStub.firstCall.args[3]?.noExtensionVariables, true);
    });
});
