import * as pulumi from "@pulumi/pulumi";
import * as pulumiharbor from "@pulumiverse/harbor";

require("dotenv").config({ path: [".env.local", ".env"] });

// Environment variable checks
if (process.env.PULUMI_ACCESS_TOKEN == null) {
    throw new Error("NO PULUMI_ACCESS_TOKEN env variable set");
}

// Reference infrastructure stack
const infrastructureStack = new pulumi.StackReference("egulatee/harbor-infrastructure/dev");

// Get required values from infrastructure stack
const harborAdminPassword = infrastructureStack.requireOutput("harborAdminPasswordExport");
const harborUrl = infrastructureStack.requireOutput("harborUrl");
const aiaugmentedProjectName = infrastructureStack.requireOutput("aiaugmentedProjectName");

// Configure Harbor provider using infrastructure stack outputs
const harborProvider = new pulumiharbor.Provider(
    "harborprovider",
    {
        url: harborUrl,
        username: "admin",
        password: harborAdminPassword,
    }
);

// Project member assignments removed - only robot account is used

// Create robot account for CI/CD with push/pull permissions to aiaugmentedsoftwaredev project
// Robot account doesn't depend on user login - it's created directly in Harbor
const cicdRobotAccount = new pulumiharbor.RobotAccount(
    "cicd-robot",
    {
        name: "github-actions-cicd",
        description: "Robot account for GitHub Actions CI/CD pipelines",
        level: "project",
        permissions: [{
            kind: "project",
            namespace: aiaugmentedProjectName,
            accesses: [
                {
                    action: "pull",
                    resource: "repository"
                },
                {
                    action: "push",
                    resource: "repository"
                }
            ]
        }]
    },
    {
        provider: harborProvider
    }
);

console.log("✅ Harbor Permissions configured successfully!");
console.log("Robot account created for CI/CD use");

// Export robot account credentials for CI/CD
// Use fullName which contains the complete robot account name (robot$project+name)
export const robotAccountName = cicdRobotAccount.fullName;
export const robotAccountSecret = cicdRobotAccount.secret;