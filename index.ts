import * as pulumi from "@pulumi/pulumi";
import * as pulumiharbor from "@pulumiverse/harbor";

require("dotenv").config({ path: [".env.local", ".env"] });

// Environment variable checks
if (process.env.PULUMI_ACCESS_TOKEN == null) {
    throw new Error("No PULUMI_ACCESS_TOKEN env variable set");
}

// Generate random CLI secret (45 chars, alphanumeric)
const generateRandomPassword = (length: number = 45): string => {
    return Array.from({length}, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        .charAt(Math.floor(Math.random() * 62))
    ).join('');
};

const harborGithubUserCliSecret = generateRandomPassword();

// Reference harbor-infrastructure stack
const infrastructureStack = new pulumi.StackReference("egulatee/harbor-infrastructure/dev");

// Get required values from infrastructure stack
const harborUrl = infrastructureStack.requireOutput("harborUrl");
const harborAdminPassword = infrastructureStack.requireOutput("harborAdminPasswordExport");
const harborGithubUserName = infrastructureStack.requireOutput("harborGithubUserName");
const proxyCacheProjectName = infrastructureStack.requireOutput("proxyCacheProjectName");
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

// Add user as project member for proxy-cache project
const proxycacheprojectmember = new pulumiharbor.ProjectMemberUser(
    "proxy-cache-member",
    {
        projectId: proxyCacheProjectName,
        userName: harborGithubUserName,
        role: "projectadmin",
    },
    {
        provider: harborProvider,
    }
);

// Add user as project member for aiaugmentedsoftwaredev project
const aiaugmentedsoftwaredevprojectmember = new pulumiharbor.ProjectMemberUser(
    "aiaugmentedsoftwaredev-member",
    {
        projectId: aiaugmentedProjectName,
        userName: harborGithubUserName,
        role: "projectadmin",
    },
    {
        provider: harborProvider,
    }
);

// Set the generated CLI secret for the Harbor user via API
const setCliSecretProvider: pulumi.dynamic.ResourceProvider = {
    async create(inputs: any) {
        const https = require('https');
        const url = require('url');

        const harborUrl = inputs.harborUrl;
        const adminUsername = 'admin';
        const adminPassword = inputs.adminPassword;
        const targetUsername = inputs.username;
        const cliSecret = inputs.cliSecret;
        const maxRetries = inputs.maxRetries || 30;
        const retryDelayMs = inputs.retryDelayMs || 5000;

        const authHeader = 'Basic ' + Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64');

        // Helper function to wait
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        // Helper function to make API request
        const makeRequest = (requestOptions: any, data?: string): Promise<any> => {
            return new Promise((resolve, reject) => {
                const req = https.request(requestOptions, (res: any) => {
                    let responseData = '';
                    res.on('data', (chunk: any) => responseData += chunk);
                    res.on('end', () => {
                        resolve({
                            statusCode: res.statusCode,
                            data: responseData
                        });
                    });
                });
                req.on('error', reject);
                if (data) {
                    req.write(data);
                }
                req.end();
            });
        };

        // Retry logic to wait for user to exist in Harbor
        let attempt = 0;
        while (attempt < maxRetries) {
            try {
                console.log(`Attempt ${attempt + 1}/${maxRetries}: Checking if user ${targetUsername} exists in Harbor...`);

                const parsedUrl = url.parse(`${harborUrl}/api/v2.0/users?username=${targetUsername}`);
                const getUserResponse = await makeRequest({
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || 443,
                    path: parsedUrl.path,
                    method: 'GET',
                    rejectUnauthorized: false,
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    }
                });

                if (getUserResponse.statusCode >= 200 && getUserResponse.statusCode < 300) {
                    const users = JSON.parse(getUserResponse.data);
                    if (users.length > 0) {
                        const userId = users[0].user_id;
                        console.log(`User ${targetUsername} found with ID: ${userId}. Setting CLI secret...`);

                        // Set the CLI secret
                        const secretData = JSON.stringify({ secret: cliSecret });
                        const setSecretResponse = await makeRequest({
                            hostname: parsedUrl.hostname,
                            port: parsedUrl.port || 443,
                            path: `/api/v2.0/users/${userId}/cli_secret`,
                            method: 'PUT',
                            rejectUnauthorized: false,
                            headers: {
                                'Authorization': authHeader,
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(secretData)
                            }
                        }, secretData);

                        if (setSecretResponse.statusCode >= 200 && setSecretResponse.statusCode < 300) {
                            console.log(`CLI secret successfully set for user ${targetUsername}`);
                            return {
                                id: `harbor-cli-secret-${targetUsername}`,
                                outs: {
                                    cliSecret: cliSecret,
                                    userId: userId,
                                    status: 'updated',
                                    attempts: attempt + 1
                                }
                            };
                        } else {
                            console.log(`Failed to set CLI secret: ${setSecretResponse.statusCode} - ${setSecretResponse.data}`);
                            throw new Error(`Failed to set CLI secret: ${setSecretResponse.statusCode} - ${setSecretResponse.data}`);
                        }
                    }
                }

                console.log(`User ${targetUsername} not found in Harbor yet. Retrying in ${retryDelayMs}ms...`);
                attempt++;
                if (attempt < maxRetries) {
                    await sleep(retryDelayMs);
                }
            } catch (error) {
                console.log(`Error on attempt ${attempt + 1}: ${error}`);
                attempt++;
                if (attempt < maxRetries) {
                    await sleep(retryDelayMs);
                } else {
                    throw error;
                }
            }
        }

        throw new Error(`User ${targetUsername} not found in Harbor after ${maxRetries} attempts. The user must log in via OIDC at least once before the CLI secret can be set.`);
    },

    async diff(id: string, oldOutputs: any, newInputs: any) {
        // If CLI secret changed, we need to update
        return {
            changes: oldOutputs.cliSecret !== newInputs.cliSecret,
            replaces: []
        };
    },

    async update(id: string, oldOutputs: any, newInputs: any) {
        return this.create!(newInputs);
    }
};

// Set the CLI secret in Harbor
class HarborCliSecretResource extends pulumi.dynamic.Resource {
    constructor(name: string, args: any, opts?: pulumi.CustomResourceOptions) {
        super(setCliSecretProvider, name, args, opts);
    }
}

const harborCliSecretSetter = new HarborCliSecretResource(
    "harbor-cli-secret-setter",
    {
        harborUrl: harborUrl,
        adminPassword: harborAdminPassword,
        username: harborGithubUserName,
        cliSecret: harborGithubUserCliSecret,
        maxRetries: 60,  // Increase retries for longer wait
        retryDelayMs: 10000  // 10 second intervals
    },
    {
        dependsOn: [proxycacheprojectmember, aiaugmentedsoftwaredevprojectmember],
        customTimeouts: {
            create: "15m",  // Allow up to 15 minutes for user to appear
            update: "15m",
            delete: "5m"
        }
    }
);

console.log("✅ Harbor Permissions configured successfully!");
console.log("");
console.log("The gha-runner user now has:");
console.log("- Project admin access to proxy-cache project");
console.log("- Project admin access to aiaugmentedsoftwaredev project");
console.log("- CLI secret will be configured automatically once user logs in via OIDC");
console.log("");
console.log("IMPORTANT: If the CLI secret setting fails during deployment,");
console.log("the user must first log in to Harbor via OIDC at least once.");
console.log("After that, run 'pulumi up' again to set the CLI secret.");

// Export CLI secret for external use
export const harborGithubUserCliSecretExport = harborGithubUserCliSecret;

// Export GitHub username for external use (required by anthropic-api workflow)
export { harborGithubUserName };