// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

using Semver;
using Spectre.Console;
using System.Diagnostics;

namespace Aspire.Cli.Utils;

internal static class AppHostHelper
{
    private static readonly ActivitySource s_activitySource = new ActivitySource(nameof(AppHostHelper));

    internal static async Task<(bool IsCompatibleAppHost, bool SupportsBackchannel, string? AspireHostingSdkVersion)> CheckAppHostCompatibilityAsync(IDotNetCliRunner runner, FileInfo projectFile, CancellationToken cancellationToken)
    {
            var appHostInformation = await GetAppHostInformationAsync(runner, projectFile, cancellationToken);

            if (appHostInformation.ExitCode != 0)
            {
                AnsiConsole.MarkupLine($"[red bold]:thumbs_down: The project could not be analyzed due to a build error. For more information run with --debug switch.[/]");
                return (false, false, null);
            }

            if (!appHostInformation.IsAspireHost)
            {
                AnsiConsole.MarkupLine($"[red bold]:thumbs_down: The project is not an Aspire app host project.[/]");
                return (false, false, null);
            }

            if (!SemVersion.TryParse(appHostInformation.AspireHostingSdkVersion, out var aspireSdkVersion))
            {
                AnsiConsole.MarkupLine($"[red bold]:thumbs_down: Could not parse Aspire SDK version.[/]");
                return (false, false, null);
            }

            var compatibleRanges = SemVersionRange.Parse("^9.2.0-dev", SemVersionRangeOptions.IncludeAllPrerelease);
            if (!aspireSdkVersion.Satisfies(compatibleRanges))
            {
                AnsiConsole.MarkupLine($"[red bold]:thumbs_down: The Aspire SDK version '{appHostInformation.AspireHostingSdkVersion}' is not supported. Please update to the latest version.[/]");
                return (false, false, appHostInformation.AspireHostingSdkVersion);
            }
            else
            {
                // NOTE: When we go to support < 9.2.0 app hosts this is where we'll make
                //       a determination as to whether the apphsot supports backchannel or not.
                return (true, true, appHostInformation.AspireHostingSdkVersion);
            }
    }

    internal static async Task<(int ExitCode, bool IsAspireHost, string? AspireHostingSdkVersion)> GetAppHostInformationAsync(IDotNetCliRunner runner, FileInfo projectFile, CancellationToken cancellationToken)
    {
        using var activity = s_activitySource.StartActivity(nameof(GetAppHostInformationAsync), ActivityKind.Client);

        var appHostInformationResult = await InteractionUtils.ShowStatusAsync(
            ":microscope: Checking project type...",
            () => runner.GetAppHostInformationAsync(projectFile, cancellationToken)
        );

        return appHostInformationResult;
    }
    
    internal static async Task<int> BuildAppHostAsync(IDotNetCliRunner runner, FileInfo projectFile, CancellationToken cancellationToken)
    {
        return await InteractionUtils.ShowStatusAsync(
            ":hammer_and_wrench:  Building app host...",
            () => runner.BuildAsync(projectFile, cancellationToken));
    }
}