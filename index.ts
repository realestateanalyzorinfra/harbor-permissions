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

        // First, get the user ID
        const getUserUrl = `${harborUrl}/api/v2.0/users?username=${targetUsername}`;
        const authHeader = 'Basic ' + Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64');

        return new Promise((resolve, reject) => {
            const parsedUrl = url.parse(getUserUrl);
            const req = https.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 443,
                path: parsedUrl.path,
                method: 'GET',
                rejectUnauthorized: false, // Ignore SSL certificate issues
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                }
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => data += chunk);
                res.on('end', () => {
                    try {
                        const users = JSON.parse(data);
                        if (users.length === 0) {
                            reject(new Error(`User ${targetUsername} not found`));
                            return;
                        }

                        const userId = users[0].user_id;

                        // Now set the CLI secret using PUT
                        const setCliSecretUrl = `${harborUrl}/api/v2.0/users/${userId}/cli_secret`;
                        const secretData = JSON.stringify({ secret: cliSecret });

                        const secretReq = https.request({
                            hostname: parsedUrl.hostname,
                            port: parsedUrl.port || 443,
                            path: `/api/v2.0/users/${userId}/cli_secret`,
                            method: 'PUT',
                            rejectUnauthorized: false, // Ignore SSL certificate issues
                            headers: {
                                'Authorization': authHeader,
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(secretData)
                            }
                        }, (secretRes: any) => {
                            if (secretRes.statusCode >= 200 && secretRes.statusCode < 300) {
                                resolve({
                                    id: `harbor-cli-secret-${targetUsername}`,
                                    outs: {
                                        cliSecret: cliSecret,
                                        userId: userId,
                                        status: 'updated'
                                    }
                                });
                            } else {
                                let errorData = '';
                                secretRes.on('data', (chunk: any) => errorData += chunk);
                                secretRes.on('end', () => {
                                    reject(new Error(`Failed to set CLI secret: ${secretRes.statusCode} - ${errorData}`));
                                });
                            }
                        });

                        secretReq.on('error', reject);
                        secretReq.write(secretData);
                        secretReq.end();

                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.end();
        });
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
        cliSecret: harborGithubUserCliSecret
    },
    {
        dependsOn: [proxycacheprojectmember, aiaugmentedsoftwaredevprojectmember]
    }
);

console.log("✅ Harbor Permissions configured successfully!");
console.log("");
console.log("The gha-runner user now has:");
console.log("- Project admin access to proxy-cache project");
console.log("- Project admin access to aiaugmentedsoftwaredev project");
console.log("- CLI secret configured for automated access");

// Export CLI secret for external use
export const harborGithubUserCliSecretExport = harborGithubUserCliSecret;