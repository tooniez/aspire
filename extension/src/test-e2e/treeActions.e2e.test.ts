import * as assert from 'assert';
import * as path from 'path';
import { findResource, getCommandInvocationCount, getTerminalCommandCount, isSamePath, waitForAppHostLaunching, waitForCommandOutcome, waitForDashboardUrl, waitForExtensionState, waitForHttpText, waitForNoRunningAppHost, waitForRepositoryIdle, waitForResource, waitForResourceState, waitForRunningAppHost, waitForTerminalCommand, waitForWorkspaceAppHost } from './helpers/assertions';
import { executeE2eControlCommand, restoreWorkspaceCliPath, runE2eTeardown, setCliUnavailableForE2E, setTerminalCommandExecutionSuppressedForE2E, stopPrimaryAppHostIfRunning } from './helpers/fixtures';
import { getPrimaryAppHostProjectPath } from './helpers/paths';
import { answerActiveInput, chooseActiveQuickPick, openAspireView, waitForEditorTitle } from './helpers/vscode';

suite('Aspire tree action command E2E', function () {
    this.timeout(300000);

    teardown(async () => {
        await runE2eTeardown([
            () => setCliUnavailableForE2E(false),
            () => setTerminalCommandExecutionSuppressedForE2E(false),
            () => restoreWorkspaceCliPath(),
            () => stopPrimaryAppHostIfRunning(),
            () => waitForNoRunningAppHost(),
        ], 'Tree action E2E teardown failed.');
    });

    test('routes view, copy, endpoint, log, and resource commands through tree handlers', async () => {
        await openAspireView();
        await waitForRepositoryIdle();
        const discovered = await waitForWorkspaceAppHost();
        await openAspireView();
        const appHostPath = discovered.state.workspaceAppHostPath ?? getPrimaryAppHostProjectPath();

        let before = getCommandInvocationCount('aspire-vscode.switchToGlobalView');
        await executeE2eControlCommand({ name: 'switchToGlobalView' });
        await waitForCommandOutcome('aspire-vscode.switchToGlobalView', 'success', 60000, before);
        await waitForExtensionState(file => file.state.viewMode === 'global', 'global AppHost view');

        before = getCommandInvocationCount('aspire-vscode.globalRefreshAppHosts');
        await executeE2eControlCommand({ name: 'globalRefreshAppHosts' });
        await waitForCommandOutcome('aspire-vscode.globalRefreshAppHosts', 'success', 60000, before);

        before = getCommandInvocationCount('aspire-vscode.switchToWorkspaceView');
        await executeE2eControlCommand({ name: 'switchToWorkspaceView' });
        await waitForCommandOutcome('aspire-vscode.switchToWorkspaceView', 'success', 60000, before);
        await waitForExtensionState(file => file.state.viewMode === 'workspace', 'workspace AppHost view');

        before = getCommandInvocationCount('aspire-vscode.runAppHost');
        await executeE2eControlCommand({ name: 'runAppHost', appHostPath }, { waitFor: 'started' });
        await waitForAppHostLaunching(appHostPath);
        await waitForCommandOutcome('aspire-vscode.runAppHost', 'success', 120000, before);
        await waitForRunningAppHost();
        const runningResources = await waitForResourceState('e2e-worker', ['Running'], 180000);
        const workerResource = findResource(runningResources.state, 'e2e-worker');
        assert.ok(workerResource, 'Expected e2e-worker to be present after AppHost startup.');
        const workerResourceName = workerResource.name;
        await waitForDashboardUrl();

        const copiedAppHost = await executeE2eControlCommand({ name: 'copyAppHostPath', appHostPath });
        assert.ok(isSamePath(String(copiedAppHost.result), appHostPath));

        const openedSource = await executeE2eControlCommand({ name: 'openAppHostSource', appHostPath });
        assert.ok(String((openedSource.result as { fileName?: string }).fileName).endsWith(path.join('AspireE2E.AppHost', 'AppHost.cs')));

        const viewedSource = await executeE2eControlCommand({ name: 'viewAppHostSource', appHostPath });
        assert.ok(String((viewedSource.result as { uri?: string }).uri).startsWith('aspire-source:'));

        const copiedResourceName = await executeE2eControlCommand({ name: 'copyResourceName', appHostPath, resourceName: 'e2e-worker' });
        assert.strictEqual(copiedResourceName.result, 'e2e-worker');

        const copiedEndpointUrl = await executeE2eControlCommand({ name: 'copyEndpointUrl', appHostPath, resourceName: 'e2e-worker' });
        const endpointUrl = String(copiedEndpointUrl.result);
        assert.ok(endpointUrl.startsWith('http'));

        before = getCommandInvocationCount('aspire-vscode.openInIntegratedBrowser');
        await executeE2eControlCommand({ name: 'openInIntegratedBrowser', appHostPath, resourceName: 'e2e-worker' });
        await waitForCommandOutcome('aspire-vscode.openInIntegratedBrowser', 'success', 60000, before);
        assert.ok((await waitForEditorTitle(new URL(endpointUrl).host, 120000, { matchCase: false })).toLowerCase().includes(new URL(endpointUrl).host.toLowerCase()));
        assert.strictEqual(await waitForHttpText(endpointUrl, 'ok'), 'ok');

        const viewedLog = await executeE2eControlCommand({ name: 'viewAppHostLogFile', appHostPath });
        const viewedLogFileName = (viewedLog.result as { fileName?: string }).fileName;
        assert.ok(viewedLogFileName && path.isAbsolute(viewedLogFileName));

        const copiedLogPath = await executeE2eControlCommand({ name: 'copyLogFilePath', appHostPath });
        assert.ok(path.isAbsolute(String(copiedLogPath.result)));

        let terminalBefore: number;
        await setTerminalCommandExecutionSuppressedForE2E(true);
        before = getCommandInvocationCount('aspire-vscode.viewResourceLogs');
        terminalBefore = getTerminalCommandCount();
        await executeE2eControlCommand({ name: 'viewResourceLogs', appHostPath, resourceName: 'e2e-worker' });
        await waitForCommandOutcome('aspire-vscode.viewResourceLogs', 'success', 60000, before);
        await waitForTerminalCommand(
            event => event.subcommand.includes('logs "e2e-worker"') && event.executionSuppressed,
            'suppressed logs terminal command',
            60000,
            terminalBefore);
        await setTerminalCommandExecutionSuppressedForE2E(false);

        await waitForResource('e2e-worker');
        await waitForResourceState('e2e-worker', ['Running'], 90000);

        before = getCommandInvocationCount('aspire-vscode.stopResource');
        terminalBefore = getTerminalCommandCount();
        await executeE2eControlCommand({ name: 'stopResource', appHostPath, resourceName: workerResourceName });
        await waitForCommandOutcome('aspire-vscode.stopResource', 'success', 60000, before);
        await waitForResourceTerminalCommand(workerResourceName, 'stop', terminalBefore);
        await waitForResourceState(workerResourceName, ['Stopped', 'Finished', 'Exited'], 90000);

        before = getCommandInvocationCount('aspire-vscode.startResource');
        terminalBefore = getTerminalCommandCount();
        await executeE2eControlCommand({ name: 'startResource', appHostPath, resourceName: workerResourceName });
        await waitForCommandOutcome('aspire-vscode.startResource', 'success', 60000, before);
        await waitForResourceTerminalCommand(workerResourceName, 'start', terminalBefore);

        before = getCommandInvocationCount('aspire-vscode.restartResource');
        terminalBefore = getTerminalCommandCount();
        await executeE2eControlCommand({ name: 'restartResource', appHostPath, resourceName: workerResourceName });
        await waitForCommandOutcome('aspire-vscode.restartResource', 'success', 60000, before);
        await waitForResourceTerminalCommand(workerResourceName, 'restart', terminalBefore);

        await setTerminalCommandExecutionSuppressedForE2E(true);
        before = getCommandInvocationCount('aspire-vscode.executeResourceCommand');
        terminalBefore = getTerminalCommandCount();
        await executeE2eControlCommand({ name: 'executeResourceCommand', appHostPath, resourceName: workerResourceName }, { waitFor: 'started' });
        await chooseActiveQuickPick('echo-arguments');
        await chooseActiveQuickPick('Continue');
        await answerActiveInput('hello from e2e', 'Message');
        await chooseActiveQuickPick('Beta');
        await chooseActiveQuickPick('Yes');
        await answerActiveInput('42.5', 'Threshold');
        await answerActiveInput('secret-from-e2e', 'Token');
        await waitForCommandOutcome('aspire-vscode.executeResourceCommand', 'success', 60000, before);

        const resourceCommand = await waitForTerminalCommand(
            event => event.subcommand.includes('resource "') && event.subcommand.includes('"echo-arguments"') && event.executionSuppressed,
            'resource command with prompted arguments',
            60000,
            terminalBefore);
        assert.ok(resourceCommand.containsRedactedArgs);
        assert.strictEqual(resourceCommand.additionalArgs, undefined);
        assert.ok(resourceCommand.commandLine.includes('[redacted command arguments]'));
        assert.ok(!resourceCommand.commandLine.includes('secret-from-e2e'));
    });
});

async function waitForResourceTerminalCommand(resourceName: string, command: string, afterCommandSequence: number): Promise<void> {
    await waitForTerminalCommand(
        event => event.subcommand.includes(`resource "${resourceName}"`) && event.subcommand.includes(` ${command}`),
        `${command} terminal command for ${resourceName}`,
        60000,
        afterCommandSequence);
}
