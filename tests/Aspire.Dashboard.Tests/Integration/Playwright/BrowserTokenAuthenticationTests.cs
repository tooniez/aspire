// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

using Aspire.TestUtilities;
using Aspire.Dashboard.Configuration;
using Aspire.Dashboard.Resources;
using Aspire.Dashboard.Tests.Integration.Playwright.Infrastructure;
using Aspire.Hosting;
using Microsoft.AspNetCore.InternalTesting;
using Microsoft.Playwright;
using Xunit;

namespace Aspire.Dashboard.Tests.Integration.Playwright;

[RequiresPlaywright]
public class BrowserTokenAuthenticationTests : PlaywrightTestsBase<BrowserTokenAuthenticationTests.BrowserTokenDashboardServerFixture>
{
    public class BrowserTokenDashboardServerFixture : DashboardServerFixture
    {
        public BrowserTokenDashboardServerFixture()
        {
            Configuration[DashboardConfigNames.DashboardFrontendAuthModeName.ConfigKey] = nameof(FrontendAuthMode.BrowserToken);
            Configuration[DashboardConfigNames.DashboardFrontendBrowserTokenName.ConfigKey] = "VALID_TOKEN";
        }
    }

    public BrowserTokenAuthenticationTests(BrowserTokenDashboardServerFixture dashboardServerFixture)
        : base(dashboardServerFixture)
    {
    }

    [Fact]
    public async Task BrowserToken_LoginPage_Success_RedirectToResources()
    {
        // Arrange
        await RunTestAsync(async page =>
        {
            // Act
            var response = await page.GotoAsync("/").DefaultTimeout(TestConstants.LongTimeoutTimeSpan);
            var uri = new Uri(response!.Url);

            Assert.Equal("/login?returnUrl=%2F", uri.PathAndQuery);

            var tokenTextBox = page.GetByRole(AriaRole.Textbox);
            await tokenTextBox.FillAsync("VALID_TOKEN").DefaultTimeout(TestConstants.LongTimeoutTimeSpan);

            var submitButton = page.GetByRole(AriaRole.Button);
            await submitButton.ClickAsync().DefaultTimeout(TestConstants.LongTimeoutTimeSpan);

            // Assert
            await Assertions
                .Expect(page.GetByText(MockDashboardClient.TestResource1.DisplayName))
                .ToBeVisibleAsync()
                .DefaultTimeout(TestConstants.LongTimeoutTimeSpan);
        });
    }

    [Fact]
    public async Task BrowserToken_LoginPage_Failure_DisplayFailureMessage()
    {
        // Arrange
        await RunTestAsync(async page =>
        {
            // Act
            var response = await page.GotoAsync("/").DefaultTimeout(TestConstants.LongTimeoutTimeSpan);
            var uri = new Uri(response!.Url);

            Assert.Equal("/login?returnUrl=%2F", uri.PathAndQuery);

            var tokenTextBox = page.GetByRole(AriaRole.Textbox);
            await tokenTextBox.FillAsync("INVALID_TOKEN").DefaultTimeout(TestConstants.LongTimeoutTimeSpan);

            var submitButton = page.GetByRole(AriaRole.Button);
            await submitButton.ClickAsync().DefaultTimeout(TestConstants.LongTimeoutTimeSpan);

            // Assert
            await Assertions
                .Expect(page.GetByText(Login.InvalidTokenErrorMessage))
                .ToBeVisibleAsync()
                .DefaultTimeout(TestConstants.LongTimeoutTimeSpan);
        });
    }

    [Fact]
    public async Task BrowserToken_QueryStringToken_Success_RestrictToResources()
    {
        // Arrange
        await RunTestAsync(async page =>
        {
            // Act
            await page.GotoAsync("/login?t=VALID_TOKEN").DefaultTimeout(TestConstants.LongTimeoutTimeSpan);

            // Assert
            await Assertions
                .Expect(page.GetByText(MockDashboardClient.TestResource1.DisplayName))
                .ToBeVisibleAsync()
                .DefaultTimeout(TestConstants.LongTimeoutTimeSpan);
        });
    }

    [Fact]
    public async Task BrowserToken_QueryStringToken_Failure_DisplayLoginPage()
    {
        // Arrange
        await RunTestAsync(async page =>
        {
            // Act
            await page.GotoAsync("/login?t=INVALID_TOKEN").DefaultTimeout(TestConstants.LongTimeoutTimeSpan);

            var submitButton = page.GetByRole(AriaRole.Button);
            var name = await submitButton.GetAttributeAsync("name").DefaultTimeout(TestConstants.LongTimeoutTimeSpan);

            // Assert
            Assert.Equal("submit-token", name);
        });
    }
}
