using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.Hosting;

var builder = FunctionsApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.AddAzureQueueClient("queue");
builder.AddAzureBlobClient("blob");
builder.AddAzureBlobContainerClient("myblobcontainer");
builder.AddAzureEventHubProducerClient("myhub");
#if !SKIP_UNSTABLE_EMULATORS
builder.AddAzureServiceBusClient("messaging");
#endif

builder.ConfigureFunctionsWebApplication();

var host = builder.Build();

host.Run();
