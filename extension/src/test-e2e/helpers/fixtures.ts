import * as fs from 'fs';
import * as path from 'path';
import type { AspireExtensionE2EControlCommand, AspireExtensionE2EControlStatus } from '../../types/extensionApi';
import { applyE2eControl, findRunningAppHostByPath, isSamePath, readStateFile, waitForExtensionState, waitForNoRunningAppHost } from './assertions';
import { getCliPath, getPrimaryAppHostProjectPath, getRepoRoot, getWorkspaceRoot } from './paths';
import { ProcessError, runProcess, terminateProcessTree } from './process';

const csharpFileHeader = `// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

`;
let atomicWriteSequence = 0;

export function getWorkspaceSettingsPath(): string {
    return path.join(getWorkspaceRoot(), '.vscode', 'settings.json');
}

export function getGeneratedProjectRoot(projectName: string): string {
    const workspaceRoot = path.resolve(getWorkspaceRoot());
    const projectRoot = path.resolve(workspaceRoot, projectName);
    const relativePath = path.relative(workspaceRoot, projectRoot);
    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Generated E2E project path must stay under the workspace root. Project name: ${projectName}`);
    }

    return projectRoot;
}

export function getGeneratedAppHostPath(projectName: string): string {
    return path.join(getGeneratedProjectRoot(projectName), 'apphost.cs');
}

export async function writeWorkspaceCliPath(cliPath: string): Promise<void> {
    const settingsPath = getWorkspaceSettingsPath();
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    settings['aspire.aspireCliExecutablePath'] = cliPath;
    writeFileAtomically(settingsPath, JSON.stringify(settings, undefined, 2));

    await applyE2eControl({ aspireCliExecutablePath: cliPath });
}

export async function setE2eCliPathForE2E(cliPath: string | undefined): Promise<void> {
    await applyE2eControl({ e2eCliExecutablePath: cliPath ?? null });
}

export async function restoreE2eCliPathForE2E(): Promise<void> {
    await setE2eCliPathForE2E(getCliPath());
}

export async function setCliUnavailableForE2E(forceCliUnavailable: boolean): Promise<void> {
    await applyE2eControl({ forceCliUnavailable });
}

export async function setTerminalCommandExecutionSuppressedForE2E(suppressTerminalCommandExecution: boolean): Promise<void> {
    await applyE2eControl({ suppressTerminalCommandExecution });
}

export async function setDebugLaunchSuppressedForE2E(suppressDebugLaunch: boolean): Promise<void> {
    await applyE2eControl({ suppressDebugLaunch });
}

export async function setShowStatusDelayForE2E(delayMs: number | undefined): Promise<void> {
    await applyE2eControl({ showStatusDelayMs: delayMs ?? null });
}

export async function executeE2eControlCommand(command: AspireExtensionE2EControlCommand, options?: { waitFor?: 'started' | 'applied' }): Promise<AspireExtensionE2EControlStatus> {
    return await applyE2eControl({ command }, options?.waitFor ?? 'applied');
}

export async function runE2eTeardown(cleanups: ReadonlyArray<() => unknown | Promise<unknown>>, failureMessage: string): Promise<void> {
    const failures: unknown[] = [];
    for (let i = 0; i < cleanups.length; i++) {
        const cleanup = cleanups[i];
        try {
            await cleanup();
        } catch (error) {
            failures.push(new Error(`Cleanup ${i + 1} failed: ${formatErrorForDiagnostics(error)}`, { cause: error }));
        }
    }

    if (failures.length > 0) {
        throw new AggregateError(failures, `${failureMessage}\n\n${failures.map(formatErrorForDiagnostics).join('\n\n')}`);
    }
}

export async function createEmptyAppHostProject(projectName: string): Promise<string> {
    const outputPath = getGeneratedProjectRoot(projectName);
    removePath(outputPath, { recursive: true, force: true });
    await runProcess(getCliPath(), [
        'new',
        'aspire-empty',
        '--name',
        projectName,
        '--output',
        outputPath,
        '--language',
        'csharp',
        ...getPackageSourceArgs(),
        '--suppress-agent-init',
        '--non-interactive',
        '--nologo',
    ], {
        cwd: getWorkspaceRoot(),
        timeoutMs: 180000,
    });
    await waitForPath(getGeneratedAppHostPath(projectName), 180000);
    await waitForPath(path.join(outputPath, 'aspire.config.json'), 180000);

    return outputPath;
}

export async function addIntegrationPackageToAppHost(integration: string, appHostPath: string): Promise<void> {
    await runProcess(getCliPath(), [
        'add',
        integration,
        '--apphost',
        appHostPath,
        ...getPackageVersionArgs(),
        '--non-interactive',
        '--nologo',
    ], {
        cwd: getWorkspaceRoot(),
        timeoutMs: 180000,
    });
    await waitForFileContent(appHostPath, integration, 180000);
}

export async function setSourceBreakpoint(filePath: string, line: number): Promise<void> {
    await executeE2eControlCommand({ name: 'setSourceBreakpoint', filePath, line, clearExisting: true });
    await waitForExtensionState(
        file => Array.isArray(file.control?.result) &&
            file.control.result.some((breakpoint: unknown) => isBreakpointAt(breakpoint, filePath, line)),
        `source breakpoint in ${filePath}:${line + 1}`,
        10000);
}

export async function clearBreakpoints(): Promise<void> {
    await executeE2eControlCommand({ name: 'clearBreakpoints' });
}

export function removeGeneratedProject(projectName: string): void {
    removePath(getGeneratedProjectRoot(projectName), { recursive: true, force: true });
}

export async function restoreWorkspaceCliPath(): Promise<void> {
    await writeWorkspaceCliPath(getCliPath());
}

export function removeWorkspaceAppHostConfig(): void {
    fs.rmSync(getWorkspaceAppHostConfigPath(), { force: true });
}

export function writeWorkspaceAppHostConfig(value: unknown): void {
    writeFileAtomically(getWorkspaceAppHostConfigPath(), JSON.stringify(value, undefined, 2));
}

export function writeWorkspaceAppHostConfigRaw(value: string): void {
    writeFileAtomically(getWorkspaceAppHostConfigPath(), value);
}

export function restoreWorkspaceAppHostConfig(): void {
    writeWorkspaceAppHostConfig({
        appHost: {
            path: path.join('AspireE2E.AppHost', 'AspireE2E.AppHost.csproj'),
        },
    });
}

export function writeWorkspaceAppHostConfigForPath(appHostPath: string): void {
    const relativePath = path.relative(getWorkspaceRoot(), appHostPath);
    writeWorkspaceAppHostConfig({
        appHost: {
            path: relativePath,
        },
    });
}

export function writeWorkspaceSetting(key: string, value: unknown): void {
    const settingsPath = getWorkspaceSettingsPath();
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    settings[key] = value;
    writeFileAtomically(settingsPath, JSON.stringify(settings, undefined, 2));
}

export function writeLegacyAspireSettings(appHostPath = path.join('..', 'AspireE2E.AppHost', 'AspireE2E.AppHost.csproj')): void {
    const settingsPath = getLegacyAspireSettingsPath();
    writeFileAtomically(settingsPath, JSON.stringify({ appHostPath }, undefined, 2));
}

export function removeLegacyAspireSettings(): void {
    fs.rmSync(path.join(getWorkspaceRoot(), '.aspire'), { recursive: true, force: true });
}

export function createAdditionalAppHostCandidate(projectName = 'AspireE2E.SecondAppHost'): string {
    const projectDirectory = path.join(getWorkspaceRoot(), projectName);
    fs.mkdirSync(projectDirectory, { recursive: true });

    fs.writeFileSync(path.join(projectDirectory, `${projectName}.csproj`), `<Project Sdk="Aspire.AppHost.Sdk/${getAppHostSdkVersion()}">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
`);

    fs.writeFileSync(path.join(projectDirectory, 'AppHost.cs'), `${csharpFileHeader}var builder = DistributedApplication.CreateBuilder(args);

builder.Build().Run();
`);

    return path.join(projectDirectory, `${projectName}.csproj`);
}

export function removeAdditionalAppHostCandidate(projectName = 'AspireE2E.SecondAppHost'): void {
    removePath(path.join(getWorkspaceRoot(), projectName), { recursive: true, force: true });
}

export async function stopPrimaryAppHostIfRunning(): Promise<void> {
    await stopAppHostIfRunning(getPrimaryAppHostProjectPath());
}

export async function stopAppHostIfRunning(appHostPath: string): Promise<void> {
    const appHostBeforeStop = findRunningAppHostByPathInState(appHostPath) ?? await findRunningAppHostByPathFromCli(appHostPath);
    try {
        await runProcess(getCliPath(), ['stop', '--non-interactive', '--apphost', appHostPath], {
            cwd: getWorkspaceRoot(),
            timeoutMs: 60000,
        });
    }
    catch (error) {
        if (!(error instanceof Error)) {
            throw error;
        }

        const stopErrorText = error.message;
        if (/not running|No running AppHost|No AppHost/i.test(stopErrorText)) {
            return;
        }

        if (/timed out after \d+ms/i.test(stopErrorText)) {
            await forceTerminateRunningAppHost(appHostPath, appHostBeforeStop?.appHostPid);
            try {
                await waitForNoRunningAppHost(appHostPath, 30000);
                return;
            }
            catch {
                throw error;
            }
        }

        if (/Failed to stop/i.test(stopErrorText)) {
            try {
                // Debug-session shutdown can race with the CLI's fallback stop command. If the CLI
                // had to force-terminate the AppHost it exits non-zero, but teardown should only fail
                // when the extension still observes a running or launching AppHost afterward.
                await waitForNoRunningAppHost(appHostPath, 30000);
                return;
            }
            catch {
                throw error;
            }
        }

        throw error;
    }
}

async function forceTerminateRunningAppHost(appHostPath: string, fallbackPid?: number): Promise<void> {
    const runningAppHost = findRunningAppHostByPathInState(appHostPath);
    const appHostPid = runningAppHost?.appHostPid ?? fallbackPid;
    if (appHostPid === undefined) {
        return;
    }

    terminateProcessTree(appHostPid, 'SIGTERM');
    await delay(5000);
    terminateProcessTree(appHostPid, 'SIGKILL');
}

function findRunningAppHostByPathInState(appHostPath: string): RunningAppHostProcess | undefined {
    return findRunningAppHostByPath(readStateFile().state, appHostPath);
}

async function findRunningAppHostByPathFromCli(appHostPath: string): Promise<RunningAppHostProcess | undefined> {
    try {
        const result = await runProcess(getCliPath(), ['ps', '--format', 'json'], {
            cwd: getWorkspaceRoot(),
            timeoutMs: 30000,
            rejectOnNonZeroExit: false,
        });
        if (result.exitCode !== 0) {
            return undefined;
        }

        const parsed = JSON.parse(result.stdout) as unknown;
        const appHosts = Array.isArray(parsed) ? parsed : [parsed];
        return appHosts
            .filter(isRunningAppHostProcess)
            .find(appHost => isSamePath(appHost.appHostPath, appHostPath));
    }
    catch {
        return undefined;
    }
}

function isRunningAppHostProcess(value: unknown): value is RunningAppHostProcess {
    return typeof value === 'object'
        && value !== null
        && typeof (value as RunningAppHostProcess).appHostPath === 'string'
        && typeof (value as RunningAppHostProcess).appHostPid === 'number';
}

function getAppHostSdkVersion(): string {
    if (process.env.ASPIRE_EXTENSION_E2E_APPHOST_SDK_VERSION) {
        return process.env.ASPIRE_EXTENSION_E2E_APPHOST_SDK_VERSION;
    }

    const versionsProps = fs.readFileSync(path.join(getRepoRoot(), 'eng', 'Versions.props'), 'utf8');
    const major = getXmlProperty(versionsProps, 'MajorVersion');
    const minor = getXmlProperty(versionsProps, 'MinorVersion');
    const patch = getXmlProperty(versionsProps, 'PatchVersion');
    const prerelease = getXmlProperty(versionsProps, 'PreReleaseVersionLabel');
    return `${major}.${minor}.${patch}-${prerelease}`;
}

function getXmlProperty(xml: string, name: string): string {
    const match = xml.match(new RegExp(`<${name}>([^<]+)</${name}>`));
    if (!match) {
        throw new Error(`Unable to find ${name} in eng/Versions.props.`);
    }

    return match[1];
}

function getWorkspaceAppHostConfigPath(): string {
    return path.join(getWorkspaceRoot(), 'aspire.config.json');
}

function getLegacyAspireSettingsPath(): string {
    return path.join(getWorkspaceRoot(), '.aspire', 'settings.json');
}

function getPackageSourceArgs(): string[] {
    const args: string[] = [];
    args.push(...getPackageVersionArgs());
    if (process.env.ASPIRE_EXTENSION_E2E_PACKAGE_SOURCE) {
        args.push('--source', process.env.ASPIRE_EXTENSION_E2E_PACKAGE_SOURCE);
    }

    return args;
}

function getPackageVersionArgs(): string[] {
    return process.env.ASPIRE_EXTENSION_E2E_APPHOST_SDK_VERSION
        ? ['--version', process.env.ASPIRE_EXTENSION_E2E_APPHOST_SDK_VERSION]
        : [];
}

async function waitForPath(filePath: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (fs.existsSync(filePath)) {
            return;
        }

        await delay(500);
    }

    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${filePath} to exist.`);
}

async function waitForFileContent(filePath: string, expectedText: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    let lastContent = '<missing>';
    while (Date.now() - started < timeoutMs) {
        if (fs.existsSync(filePath)) {
            lastContent = fs.readFileSync(filePath, 'utf8');
            if (lastContent.includes(expectedText)) {
                return;
            }
        }

        await delay(500);
    }

    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${filePath} to contain '${expectedText}'. Last content:\n${lastContent}`);
}

function isBreakpointAt(value: unknown, filePath: string, line: number): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { filePath?: unknown; line?: unknown; enabled?: unknown };
    return candidate.filePath === filePath && candidate.line === line && candidate.enabled === true;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatErrorForDiagnostics(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }

    return String(error);
}

function removePath(targetPath: string, options: fs.RmOptions): void {
    fs.rmSync(targetPath, {
        maxRetries: process.platform === 'win32' ? 20 : 0,
        retryDelay: 250,
        ...options,
    });
}

interface RunningAppHostProcess {
    readonly appHostPath: string;
    readonly appHostPid: number;
}

function writeFileAtomically(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${atomicWriteSequence++}.tmp`;
    fs.writeFileSync(temporaryPath, content);
    try {
        renameFileWithRetry(temporaryPath, filePath);
    }
    finally {
        fs.rmSync(temporaryPath, { force: true });
    }
}

function renameFileWithRetry(sourcePath: string, destinationPath: string): void {
    const maxAttempts = process.platform === 'win32' ? 10 : 1;
    for (let attempt = 1; ; attempt++) {
        try {
            fs.renameSync(sourcePath, destinationPath);
            return;
        }
        catch (error) {
            if (attempt >= maxAttempts || !isRetryableRenameError(error)) {
                throw error;
            }

            sleepSynchronously(25);
        }
    }
}

function isRetryableRenameError(error: unknown): boolean {
    if (process.platform !== 'win32' || !error || typeof error !== 'object' || !('code' in error)) {
        return false;
    }

    return error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EEXIST';
}

function sleepSynchronously(milliseconds: number): void {
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}
