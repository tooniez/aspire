// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Azure.Utils;
using Aspire.Hosting.Publishing;

namespace Aspire.Hosting.Azure;

/// <summary>
/// Represents an Azure Bicep resource.
/// </summary>
public class AzureBicepResource : Resource, IAzureResource, IResourceWithParameters
{
    /// <summary>
    /// Initializes a new instance of the <see cref="AzureBicepResource"/> class.
    /// </summary>
    /// <param name="name">Name of the resource. This will be the name of the deployment.</param>
    /// <param name="templateFile">The path to the bicep file.</param>
    /// <param name="templateString">A bicep snippet.</param>
    /// <param name="templateResourceName">The name of an embedded resource that represents the bicep file.</param>
    public AzureBicepResource(string name, string? templateFile = null, string? templateString = null, string? templateResourceName = null) : base(name)
    {
        TemplateFile = templateFile;
        TemplateString = templateString;
        TemplateResourceName = templateResourceName;

        Annotations.Add(new ManifestPublishingCallbackAnnotation(WriteToManifest));
    }

    internal string? TemplateFile { get; }

    internal string? TemplateString { get; set; }

    internal string? TemplateResourceName { get; }

    /// <summary>
    /// Parameters that will be passed into the bicep template.
    /// </summary>
    public Dictionary<string, object?> Parameters { get; } = [];

    IDictionary<string, object?> IResourceWithParameters.Parameters => Parameters;

    /// <summary>
    /// Outputs that will be generated by the bicep template.
    /// </summary>
    public Dictionary<string, object?> Outputs { get; } = [];

    /// <summary>
    /// Secret outputs that will be generated by the bicep template.
    /// </summary>
    public Dictionary<string, string?> SecretOutputs { get; } = [];

    /// <summary>
    /// The task completion source for the provisioning operation.
    /// </summary>
    public TaskCompletionSource? ProvisioningTaskCompletionSource { get; set; }

    /// <summary>
    /// The scope of the resource that will be configured in the main Bicep file.
    /// </summary>
    /// <remarks>
    /// The property is used to configure the Bicep scope that is emitted
    /// in the module definition for a given resource. It is
    /// only emitted for schema versions azure.bicep.v1.
    /// </remarks>
    public AzureBicepResourceScope? Scope { get; set; }

    /// <summary>
    /// For testing purposes only.
    /// </summary>
    internal string? TempDirectory { get; set; }

    /// <summary>
    /// Gets the path to the bicep file. If the template is a string or embedded resource, it will be written to a temporary file.
    /// </summary>
    /// <param name="directory">The directory where the bicep file will be written to (if it's a temporary file)</param>
    /// <param name="deleteTemporaryFileOnDispose">A boolean that determines if the file should be deleted on disposal of the <see cref="BicepTemplateFile"/>.</param>
    /// <returns>A <see cref="BicepTemplateFile"/> that represents the bicep file.</returns>
    /// <exception cref="InvalidOperationException"></exception>
    public virtual BicepTemplateFile GetBicepTemplateFile(string? directory = null, bool deleteTemporaryFileOnDispose = true)
    {
        // Throw if multiple template sources are specified
        if (TemplateFile is not null && (TemplateString is not null || TemplateResourceName is not null))
        {
            throw new InvalidOperationException("Multiple template sources are specified.");
        }

        var path = TemplateFile;
        var isTempFile = false;

        if (path is null)
        {
            isTempFile = directory is null;

            path = TempDirectory is null
                ? Path.Combine(directory ?? Directory.CreateTempSubdirectory("aspire").FullName, $"{Name.ToLowerInvariant()}.module.bicep")
                : Path.Combine(TempDirectory, $"{Name.ToLowerInvariant()}.module.bicep");

            if (TemplateResourceName is null)
            {
                // REVIEW: Consider making users specify a name for the template
                File.WriteAllText(path, TemplateString);
            }
            else
            {
                path = directory is null
                    ? path
                    : Path.Combine(directory, $"{TemplateResourceName.ToLowerInvariant()}");

                // REVIEW: We should allow the user to specify the assembly where the resources reside.
                using var resourceStream = GetType().Assembly.GetManifestResourceStream(TemplateResourceName)
                    ?? throw new InvalidOperationException($"Could not find resource {TemplateResourceName} in assembly {GetType().Assembly}");

                using var fs = File.OpenWrite(path);
                resourceStream.CopyTo(fs);
            }
        }

        return new(path, isTempFile && deleteTemporaryFileOnDispose);
    }

    /// <summary>
    /// Get the bicep template as a string. Does not write to disk.
    /// </summary>
    public virtual string GetBicepTemplateString()
    {
        if (TemplateString is not null)
        {
            return TemplateString;
        }

        if (TemplateResourceName is not null)
        {
            using var resourceStream = GetType().Assembly.GetManifestResourceStream(TemplateResourceName)
                ?? throw new InvalidOperationException($"Could not find resource {TemplateResourceName} in assembly {GetType().Assembly}");

            using var reader = new StreamReader(resourceStream, Encoding.UTF8);
            return reader.ReadToEnd();
        }

        if (TemplateFile is null)
        {
            throw new InvalidOperationException("No template source specified.");
        }

        return File.ReadAllText(TemplateFile);
    }

    /// <summary>
    /// Writes the resource to the manifest.
    /// </summary>
    /// <param name="context">The <see cref="ManifestPublishingContext"/>.</param>
    public virtual void WriteToManifest(ManifestPublishingContext context)
    {
        using var template = GetBicepTemplateFile(Path.GetDirectoryName(context.ManifestPath), deleteTemporaryFileOnDispose: false);
        var path = template.Path;

        if (Scope is null)
        {
            context.Writer.WriteString("type", "azure.bicep.v0");
        }
        else
        {
            context.Writer.WriteString("type", "azure.bicep.v1");
        }

        // Write a connection string if it exists.
        context.WriteConnectionString(this);

        // REVIEW: Consider multiple files.
        context.Writer.WriteString("path", context.GetManifestRelativePath(path));

        if (Parameters.Count > 0)
        {
            context.Writer.WriteStartObject("params");
            foreach (var input in Parameters)
            {
                // Used for deferred evaluation of parameter.
                object? inputValue = input.Value is Func<object?> f ? f() : input.Value;

                if (inputValue is JsonNode || inputValue is IEnumerable<string>)
                {
                    context.Writer.WritePropertyName(input.Key);
                    // Write JSON objects to the manifest for JSON node parameters
                    JsonSerializer.Serialize(context.Writer, inputValue);
                    continue;
                }

                var value = inputValue switch
                {
                    IManifestExpressionProvider output => output.ValueExpression,
                    object obj => obj.ToString(),
                    null => ""
                };

                context.Writer.WriteString(input.Key, value);

                context.TryAddDependentResources(input.Value);
            }
            context.Writer.WriteEndObject();
        }

        if (Scope is not null)
        {
            context.Writer.WriteStartObject("scope");
            var resourceGroup = Scope.ResourceGroup switch
            {
                IManifestExpressionProvider output => output.ValueExpression,
                object obj => obj.ToString(),
                null => ""
            };
            context.Writer.WriteString("resourceGroup", resourceGroup);
            context.Writer.WriteEndObject();
        }
    }

    /// <summary>
    /// Known parameters that will be filled in automatically by the host environment.
    /// </summary>
    public static class KnownParameters
    {
        private const string UserPrincipalIdConst = "userPrincipalId";
        private const string PrincipalIdConst = "principalId";
        private const string PrincipalNameConst = "principalName";
        private const string PrincipalTypeConst = "principalType";
        private const string KeyVaultNameConst = "keyVaultName";
        private const string LocationConst = "location";
        private const string LogAnalyticsWorkspaceIdConst = "logAnalyticsWorkspaceId";

        /// <summary>
        /// The principal id of the current user or managed identity.
        /// </summary>
        public static readonly string PrincipalId = PrincipalIdConst;

        /// <summary>
        /// The principal name of the current user or managed identity.
        /// </summary>
        public static readonly string PrincipalName = PrincipalNameConst;

        /// <summary>
        /// The principal type of the current user or managed identity. Either 'User' or 'ServicePrincipal'.
        /// </summary>
        public static readonly string PrincipalType = PrincipalTypeConst;

        /// <summary>
        /// The principal id of the user doing the deployment.
        /// </summary>
        /// <remarks>Referred as Deployment principal in ARM documentation.</remarks>
        public static readonly string UserPrincipalId = UserPrincipalIdConst;

        /// <summary>
        /// The name of the key vault resource used to store secret outputs.
        /// </summary>
        [Obsolete("KnownParameters.KeyVaultName is deprecated. Use an AzureKeyVaultResource instead.")]
        public static readonly string KeyVaultName = KeyVaultNameConst;

        /// <summary>
        /// The location of the resource. This is required for all resources.
        /// </summary>
        public static readonly string Location = LocationConst;

        /// <summary>
        /// The resource id of the log analytics workspace.
        /// </summary>
        [Obsolete("KnownParameters.LogAnalyticsWorkspaceId is deprecated. Use an AzureLogAnalyticsWorkspaceResource instead.")]
        public static readonly string LogAnalyticsWorkspaceId = LogAnalyticsWorkspaceIdConst;

        internal static bool IsKnownParameterName(string name) =>
            name is PrincipalIdConst or UserPrincipalIdConst or PrincipalNameConst or PrincipalTypeConst or KeyVaultNameConst or LocationConst or LogAnalyticsWorkspaceIdConst;

    }
}

/// <summary>
/// Represents a bicep template file.
/// </summary>
/// <param name="path">The path to the bicep file.</param>
/// <param name="deleteFileOnDispose">Determines if the file should be deleted on disposal.</param>
public readonly struct BicepTemplateFile(string path, bool deleteFileOnDispose) : IDisposable
{
    /// <summary>
    /// The path to the bicep file.
    /// </summary>
    public string Path { get; } = path;

    /// <summary>
    /// Releases the resources used by the current instance of <see cref="BicepTemplateFile" />.
    /// </summary>
    public void Dispose()
    {
        if (deleteFileOnDispose)
        {
            File.Delete(Path);
        }
    }
}

/// <summary>
/// A reference to a KeyVault secret from a bicep template.
/// </summary>
/// <param name="name">The name of the KeyVault secret.</param>
/// <param name="resource">The <see cref="AzureBicepResource"/>.</param>
[Obsolete("BicepSecretOutputReference is no longer supported. Use IAzureKeyVaultResource instead.")]
public sealed class BicepSecretOutputReference(string name, AzureBicepResource resource) : IManifestExpressionProvider, IValueProvider, IValueWithReferences
{
    /// <summary>
    /// Name of the KeyVault secret.
    /// </summary>
    public string Name { get; } = name;

    /// <summary>
    /// The instance of the bicep resource.
    /// </summary>
    public AzureBicepResource Resource { get; } = resource;

    /// <summary>
    /// The value of the output.
    /// </summary>
    /// <param name="cancellationToken"> A <see cref="CancellationToken"/> to observe while waiting for the task to complete.</param>
    public async ValueTask<string?> GetValueAsync(CancellationToken cancellationToken = default)
    {
        if (Resource.ProvisioningTaskCompletionSource is not null)
        {
            await Resource.ProvisioningTaskCompletionSource.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
        }

        return Value;
    }

    /// <summary>
    /// The value of the output.
    /// </summary>
    public string? Value
    {
        get
        {
            if (!Resource.SecretOutputs.TryGetValue(Name, out var value))
            {
                throw new InvalidOperationException($"No secret output for {Name}");
            }
            return value;
        }
    }

    /// <summary>
    /// The expression used in the manifest to reference the value of the secret output.
    /// </summary>
    public string ValueExpression => $"{{{Resource.Name}.secretOutputs.{Name}}}";

    IEnumerable<object> IValueWithReferences.References => [Resource];
}

/// <summary>
/// A reference to an output from a bicep template.
/// </summary>
/// <param name="name">The name of the output</param>
/// <param name="resource">The <see cref="AzureBicepResource"/>.</param>
public sealed class BicepOutputReference(string name, AzureBicepResource resource) : IManifestExpressionProvider, IValueProvider, IValueWithReferences, IEquatable<BicepOutputReference>
{
    /// <summary>
    /// Name of the output.
    /// </summary>
    public string Name { get; } = BicepIdentifierHelpers.ThrowIfInvalid(name);

    /// <summary>
    /// The instance of the bicep resource.
    /// </summary>
    public AzureBicepResource Resource { get; } = resource;

    IEnumerable<object> IValueWithReferences.References => [Resource];

    /// <summary>
    /// The value of the output.
    /// </summary>
    /// <param name="cancellationToken"> A <see cref="CancellationToken"/> to observe while waiting for the task to complete.</param>
    public async ValueTask<string?> GetValueAsync(CancellationToken cancellationToken = default)
    {
        var provisioning = Resource.ProvisioningTaskCompletionSource;
        if (provisioning is not null)
        {
            await provisioning.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
        }

        return Value;
    }

    /// <summary>
    /// The value of the output.
    /// </summary>
    public string? Value
    {
        get
        {
            if (!Resource.Outputs.TryGetValue(Name, out var value))
            {
                throw new InvalidOperationException($"No output for {Name}");
            }

            return value?.ToString();
        }
    }

    /// <summary>
    /// The expression used in the manifest to reference the value of the output.
    /// </summary>
    public string ValueExpression => $"{{{Resource.Name}.outputs.{Name}}}";

    bool IEquatable<BicepOutputReference>.Equals(BicepOutputReference? other) =>
        other is not null &&
        other.Resource == Resource &&
        other.Name == Name;

    /// <inheritdoc/>
    public override int GetHashCode() =>
        HashCode.Combine(Resource, Name);
}
