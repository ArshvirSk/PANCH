import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// Owned by web/: the same file is enforced by the frontend's browser tests.
import securityHeaders from '../../web/security-headers.json';

export interface WebStackProps extends cdk.StackProps {
  apiUrl: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    // Note: To use GitHub integration, we need a GitHub Personal Access Token in Secrets Manager.
    // We'll create a dummy secret if the user hasn't created one, but they will need to update it.
    const githubToken = secretsmanager.Secret.fromSecretNameV2(this, 'GithubToken', 'panch-github-token');

    const amplifyApp = new amplify.App(this, 'PanchWebApp', {
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: 'ArshvirSk', // using repo owner
        repository: 'PANCH',
        oauthToken: githubToken.secretValue,
      }),
      environmentVariables: {
        AMPLIFY_MONOREPO_APP_ROOT: 'web', // Build from /web subdirectory (build steps in /amplify.yml)
        // Inlined into the static Next.js build. Taken from the other stacks so nothing is hardcoded.
        NEXT_PUBLIC_API_URL: props.apiUrl,
        NEXT_PUBLIC_USER_POOL_ID: props.userPool.userPoolId,
        NEXT_PUBLIC_USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      // CSP, HSTS, clickjacking and MIME-sniffing protection on every page.
      customResponseHeaders: [{ appRoot: 'web', pattern: '**/*', headers: securityHeaders }],
    });

    // The site is a static export: serve the exported 404 page for unknown paths.
    amplifyApp.addCustomRule(new amplify.CustomRule({
      source: '/<*>',
      target: '/404.html',
      status: amplify.RedirectStatus.NOT_FOUND_REWRITE,
    }));

    amplifyApp.addBranch('main');

    new cdk.CfnOutput(this, 'AmplifyAppId', { value: amplifyApp.appId });
    new cdk.CfnOutput(this, 'WebUrl', { value: `https://main.${amplifyApp.defaultDomain}` });
  }
}
