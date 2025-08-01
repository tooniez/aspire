//------------------------------------------------------------------------------
// <auto-generated>
//     This code was generated by a tool.
//
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.
// </auto-generated>
//------------------------------------------------------------------------------
namespace Aspire.Hosting
{
    public static partial class AzureSignalRExtensions
    {
        public static ApplicationModel.IResourceBuilder<ApplicationModel.AzureSignalRResource> AddAzureSignalR(this IDistributedApplicationBuilder builder, string name, Azure.AzureSignalRServiceMode serviceMode) { throw null; }

        public static ApplicationModel.IResourceBuilder<ApplicationModel.AzureSignalRResource> AddAzureSignalR(this IDistributedApplicationBuilder builder, string name) { throw null; }

        public static ApplicationModel.IResourceBuilder<ApplicationModel.AzureSignalRResource> RunAsEmulator(this ApplicationModel.IResourceBuilder<ApplicationModel.AzureSignalRResource> builder, System.Action<ApplicationModel.IResourceBuilder<Azure.AzureSignalREmulatorResource>>? configureContainer = null) { throw null; }

        public static ApplicationModel.IResourceBuilder<T> WithRoleAssignments<T>(this ApplicationModel.IResourceBuilder<T> builder, ApplicationModel.IResourceBuilder<ApplicationModel.AzureSignalRResource> target, params global::Azure.Provisioning.SignalR.SignalRBuiltInRole[] roles)
            where T : ApplicationModel.IResource { throw null; }
    }
}

namespace Aspire.Hosting.ApplicationModel
{
    public partial class AzureSignalRResource : Azure.AzureProvisioningResource, IResourceWithConnectionString, IResource, IManifestExpressionProvider, IValueProvider, IValueWithReferences, IResourceWithEndpoints
    {
        public AzureSignalRResource(string name, System.Action<Azure.AzureResourceInfrastructure> configureInfrastructure) : base(default!, default!) { }

        public ReferenceExpression ConnectionStringExpression { get { throw null; } }

        public Azure.BicepOutputReference HostName { get { throw null; } }

        public bool IsEmulator { get { throw null; } }

        public Azure.BicepOutputReference NameOutputReference { get { throw null; } }

        public override global::Azure.Provisioning.Primitives.ProvisionableResource AddAsExistingResource(Azure.AzureResourceInfrastructure infra) { throw null; }
    }
}

namespace Aspire.Hosting.Azure
{
    public partial class AzureSignalREmulatorResource : ApplicationModel.ContainerResource, ApplicationModel.IResource
    {
        public AzureSignalREmulatorResource(ApplicationModel.AzureSignalRResource innerResource) : base(default!, default) { }

        public override ApplicationModel.ResourceAnnotationCollection Annotations { get { throw null; } }
    }

    public enum AzureSignalRServiceMode
    {
        Default = 0,
        Serverless = 1
    }
}