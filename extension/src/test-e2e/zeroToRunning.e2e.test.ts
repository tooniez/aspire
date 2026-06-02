import * as assert from 'assert';
import * as fs from 'fs';
import { getCommandInvocationCount, getTerminalCommandCount, waitForCommandOutcome, waitForDebugDashboardUrl, waitForDebugSessionStartup, waitForHttpText, waitForNoDebugSessions, waitForRepositoryIdle, waitForSelectedWorkspaceAppHost, waitForTerminalCommand } from './helpers/assertions';
import { addIntegrationPackageToAppHost, clearBreakpoints, createEmptyAppHostProject, executeE2eControlCommand, getGeneratedAppHostPath, removeGeneratedProject, restoreWorkspaceAppHostConfig, restoreWorkspaceCliPath, runE2eTeardown, setCliUnavailableForE2E, setTerminalCommandExecutionSuppressedForE2E, stopAppHostIfRunning, writeWorkspaceAppHostConfigForPath } from './helpers/fixtures';
import { openAspireView, waitForEditorTitle, waitForTreeItem, waitForWorkbenchTextAfterIntegratedBrowserNavigation } from './helpers/vscode';

suite('Aspire zero-to-running E2E', function () {
    this.timeout(2100000);

    const projectName = 'ExtensionZeroToRunningApp';
    const appHostPath = getGeneratedAppHostPath(projectName);

    teardown(async () => {
        await runE2eTeardown([
            () => setCliUnavailableForE2E(false),
            () => setTerminalCommandExecutionSuppressedForE2E(false),
            () => restoreWorkspaceCliPath(),
            () => clearBreakpoints(),
            () => executeE2eControlCommand({ name: 'stopDebugging' }),
            () => stopAppHostIfRunning(appHostPath),
            () => waitForNoDebugSessions(),
            () => restoreWorkspaceAppHostConfig(),
            () => executeE2eControlCommand({ name: 'closeAllEditors' }),
            () => removeGeneratedProject(projectName),
        ], 'Zero-to-running E2E teardown failed.');
    });

    test('creates a new AppHost, adds a package, and debugs to the dashboard', async () => {
        let section = await openAspireView();
        await waitForRepositoryIdle();

        await setTerminalCommandExecutionSuppressedForE2E(true);
        const beforeRoutedNewInvocation = getCommandInvocationCount('aspire-vscode.new');
        const beforeRoutedNewCommand = getTerminalCommandCount();
        await executeE2eControlCommand({ name: 'executeAspireCommand', commandId: 'aspire-vscode.new' });
        await waitForCommandOutcome('aspire-vscode.new', 'success', 60000, beforeRoutedNewInvocation);
        await waitForTerminalCommand(
            event => event.executionSuppressed && event.subcommand === 'new',
            'suppressed Aspire: New Project terminal routing',
            60000,
            beforeRoutedNewCommand);

        const beforeRoutedAddInvocation = getCommandInvocationCount('aspire-vscode.add');
        const beforeRoutedAddCommand = getTerminalCommandCount();
        await executeE2eControlCommand({ name: 'executeAspireCommand', commandId: 'aspire-vscode.add' });
        await waitForCommandOutcome('aspire-vscode.add', 'success', 60000, beforeRoutedAddInvocation);
        await waitForTerminalCommand(
            event => event.executionSuppressed && event.subcommand.startsWith('add'),
            'suppressed Aspire: Add Package terminal routing',
            60000,
            beforeRoutedAddCommand);
        await setTerminalCommandExecutionSuppressedForE2E(false);

        const projectRoot = await createEmptyAppHostProject(projectName);
        assert.ok(fs.existsSync(projectRoot));

        await addIntegrationPackageToAppHost('Aspire.Hosting.Redis', appHostPath);
        assert.match(fs.readFileSync(appHostPath, 'utf8'), /#:package Aspire\.Hosting\.Redis@/);

        writeWorkspaceAppHostConfigForPath(appHostPath);
        const beforeRefresh = getCommandInvocationCount('aspire-vscode.refreshAppHosts');
        await executeE2eControlCommand({ name: 'refreshAppHosts' });
        await waitForCommandOutcome('aspire-vscode.refreshAppHosts', 'success', 60000, beforeRefresh);
        const selected = await waitForSelectedWorkspaceAppHost(appHostPath);
        const appHostLabel = selected.state.workspaceAppHostName ?? 'apphost.cs';
        section = await openAspireView();
        const appHostItem = await waitForTreeItem(section, appHostLabel, 60000);
        await appHostItem.expand();
        await waitForTreeItem(section, 'Debug AppHost');

        const source = fs.readFileSync(appHostPath, 'utf8');
        assert.match(source, /builder\.Build\(\)\.Run\(\);/);
        await executeE2eControlCommand({ name: 'openAppHostSource', appHostPath });
        assert.ok((await waitForEditorTitle('apphost.cs')).includes('apphost.cs'));

        const beforeDebug = getCommandInvocationCount('aspire-vscode.debugAppHost');
        await executeE2eControlCommand({ name: 'debugAppHost', appHostPath });
        await waitForCommandOutcome('aspire-vscode.debugAppHost', 'success', 60000, beforeDebug);
        await waitForDebugSessionStartup(appHostPath, 300000);
        const dashboard = await waitForDebugDashboardUrl(appHostPath, 180000);
        const dashboardUrl = dashboard.state.debugSessions.find(session => session.dashboardUrl?.startsWith('http'))?.dashboardUrl;
        assert.ok(dashboardUrl);

        await waitForHttpText(dashboardUrl, 'Aspire', 180000, new URL(dashboardUrl).origin);
        if (process.platform === 'win32') {
            // Chromium webview text extraction is unreliable on hosted Windows runners after
            // integrated-browser navigation. The HTTP probe above proves the dashboard rendered
            // content, and Windows keeps the editor-title assertion as a weaker UI check.
            assert.ok((await waitForEditorTitle(new URL(dashboardUrl).host, 180000, { matchCase: false })).toLowerCase().includes(new URL(dashboardUrl).host.toLowerCase()));
        }
        else {
            const dashboardHost = new URL(dashboardUrl).host;
            const browserText = await waitForWorkbenchTextAfterIntegratedBrowserNavigation(['Resources', dashboardHost], 180000);
            assert.ok(browserText.includes('Resources') || browserText.includes(dashboardHost));
        }

        await executeE2eControlCommand({ name: 'stopDebugging' });
        await waitForNoDebugSessions();
    });
});
