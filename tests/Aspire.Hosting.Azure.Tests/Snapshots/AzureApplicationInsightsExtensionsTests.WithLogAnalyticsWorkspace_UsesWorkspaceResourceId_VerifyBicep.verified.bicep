﻿@description('The location for the resource(s) to be deployed.')
param location string = resourceGroup().location

param applicationType string = 'web'

param kind string = 'web'

param law_outputs_loganalyticsworkspaceid string

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: take('appInsights-${uniqueString(resourceGroup().id)}', 260)
  kind: kind
  location: location
  properties: {
    Application_Type: applicationType
    WorkspaceResourceId: law_outputs_loganalyticsworkspaceid
  }
  tags: {
    'aspire-resource-name': 'appInsights'
  }
}

output appInsightsConnectionString string = appInsights.properties.ConnectionString

output name string = appInsights.name
