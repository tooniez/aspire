// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

using Xunit;
using YamlDotNet.RepresentationModel;

namespace Infrastructure.Tests.Pipelines;

/// <summary>
/// Guards the shard-disable contract in <c>.github/workflows/extension-e2e-tests.yml</c>.
///
/// A shard row is disabled by adding <c>disabledIssue</c> to its matrix entry, which keeps the job
/// visible in the checks list while the underlying fixture is broken. That only works if every step
/// the disabled shard cannot survive is guarded by the same condition: guarding the prerequisite
/// installation alone leaves the suite itself running against missing prerequisites, so the shard
/// fails anyway (or worse, passes without running anything and hides the disable).
/// </summary>
public sealed class ExtensionE2eWorkflowTests
{
    private const string WorkflowRelativePath = ".github/workflows/extension-e2e-tests.yml";
    private const string DisabledGuard = "!matrix.disabledIssue";

    [Fact]
    public void DisabledShardRowsSkipEveryShardOnlyStep()
    {
        var job = LoadExtensionE2eJob();

        var disabledRows = MatrixIncludeRows(job)
            .Where(row => row.Children.ContainsKey(new YamlScalarNode("disabledIssue")))
            .ToList();
        Assert.NotEmpty(disabledRows);

        var steps = ((YamlSequenceNode)job.Children[new YamlScalarNode("steps")]).Cast<YamlMappingNode>().ToList();

        // The suite itself. Without the guard the disabled shard still runs the E2E tests, which is
        // exactly what `disabledIssue` is supposed to prevent.
        var runSuiteSteps = steps.Where(step => Scalar(step, "run")?.Contains("run-e2e.js", StringComparison.Ordinal) == true).ToList();
        Assert.NotEmpty(runSuiteSteps);
        foreach (var step in runSuiteSteps)
        {
            var condition = Scalar(step, "if");
            Assert.True(
                condition?.Contains(DisabledGuard, StringComparison.Ordinal) == true,
                $"Step '{Scalar(step, "name")}' runs the E2E suite but is not guarded by '{DisabledGuard}' (if: {condition ?? "<none>"}).");
        }

        // Shard-specific setup. Any step conditioned on a matrix capability flag belongs to one
        // shard only, so a disabled row must skip it too - otherwise the row keeps paying for (and
        // can keep failing on) setup for a suite that never runs.
        var shardSetupSteps = steps
            .Where(step => Scalar(step, "if") is { } condition
                && condition.Contains("matrix.installAzureFunctions", StringComparison.Ordinal))
            .ToList();
        Assert.NotEmpty(shardSetupSteps);
        foreach (var step in shardSetupSteps)
        {
            var condition = Scalar(step, "if")!;
            Assert.True(
                condition.Contains(DisabledGuard, StringComparison.Ordinal),
                $"Step '{Scalar(step, "name")}' is shard-specific setup but is not guarded by '{DisabledGuard}' (if: {condition}).");
        }
    }

    [Fact]
    public void DisabledShardRowsAnnounceWhyTheyAreSkipped()
    {
        var job = LoadExtensionE2eJob();
        var steps = ((YamlSequenceNode)job.Children[new YamlScalarNode("steps")]).Cast<YamlMappingNode>();

        // A green shard that ran nothing is indistinguishable from a green shard that passed unless
        // the job says so, so the disable has to be visible in the run itself.
        var noticeStep = steps.FirstOrDefault(step =>
            Scalar(step, "if")?.Contains("matrix.disabledIssue", StringComparison.Ordinal) == true
            && Scalar(step, "if")?.Contains(DisabledGuard, StringComparison.Ordinal) != true);

        Assert.NotNull(noticeStep);
        Assert.Contains("matrix.disabledIssue", Scalar(noticeStep, "run"), StringComparison.Ordinal);
    }

    private static YamlMappingNode LoadExtensionE2eJob()
    {
        var yaml = new YamlStream();
        using var reader = new StringReader(File.ReadAllText(Path.Combine(RepoRoot.Path, WorkflowRelativePath)));
        yaml.Load(reader);

        var root = (YamlMappingNode)yaml.Documents[0].RootNode;
        var jobs = (YamlMappingNode)root.Children[new YamlScalarNode("jobs")];

        return (YamlMappingNode)jobs.Children[new YamlScalarNode("extension_e2e")];
    }

    private static IEnumerable<YamlMappingNode> MatrixIncludeRows(YamlMappingNode job)
    {
        var strategy = (YamlMappingNode)job.Children[new YamlScalarNode("strategy")];
        var matrix = (YamlMappingNode)strategy.Children[new YamlScalarNode("matrix")];

        return ((YamlSequenceNode)matrix.Children[new YamlScalarNode("include")]).Cast<YamlMappingNode>();
    }

    private static string? Scalar(YamlMappingNode node, string key)
        => node.Children.TryGetValue(new YamlScalarNode(key), out var value) && value is YamlScalarNode scalar
            ? scalar.Value
            : null;
}
