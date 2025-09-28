# Harbor Permissions

This Pulumi TypeScript project manages Harbor project member assignments and CLI secrets for user access control.

## Architecture

This is **Stack 2** of a two-stack Harbor deployment:

1. **harbor-infrastructure** - Harbor deployment, OIDC setup, and projects
2. **harbor-permissions** (this repository) - Project member assignments and CLI secrets

## Components Managed

- **Project Member Assignments** - Assigns OIDC users to Harbor projects with specific roles
- **CLI Secret Management** - Configures Harbor CLI secrets for automated access
- **User Permissions**:
  - `proxy-cache` project - Project admin access
  - `aiaugmentedsoftwaredev` project - Project admin access

## Prerequisites

- **harbor-infrastructure stack deployed** - This stack must be deployed first
- OIDC user must have logged into Harbor at least once via web UI
- Pulumi CLI installed and configured
- Node.js and npm

## Environment Variables

Create `.env.local` with:

```bash
PULUMI_ACCESS_TOKEN=your_pulumi_token
```

## Deployment

```bash
# Install dependencies
npm install

# Initialize Pulumi stack (if needed)
pulumi stack init dev

# Deploy permissions (only after OIDC user login)
pulumi up
```

## Important Notes

⚠️ **OIDC User Must Login First** - Harbor users created via OIDC don't exist in Harbor until they log in through the web interface at least once. Deploy this stack only after:

1. Harbor infrastructure is deployed
2. User has logged in via Harbor web UI using OIDC

## Outputs

- `harborGithubUserCliSecretExport` - CLI secret for automated Harbor access

## Dependencies

- `egulatee/harbor-infrastructure/dev` - Harbor infrastructure stack

## User Access Verification

After deployment, verify user has project admin access:

```bash
# Test API access
curl -k -u "username:cli_secret" https://harbor.egyrllc.com/api/v2.0/projects

# Test project-specific access
curl -k -u "username:cli_secret" https://harbor.egyrllc.com/api/v2.0/projects/aiaugmentedsoftwaredev/repositories
```

## Troubleshooting

If deployment fails with "user not found":
1. Ensure the OIDC user has logged into Harbor web UI at least once
2. Check that the harbor-infrastructure stack is deployed and accessible
3. Verify OIDC authentication is working in Harbor

## CLI Usage

Use the exported CLI secret for automated Harbor operations:

```bash
# Docker login
docker login harbor.egyrllc.com -u gha-runner154 -p <cli_secret>

# Harbor CLI
harbor login harbor.egyrllc.com -u gha-runner154 -p <cli_secret>
```