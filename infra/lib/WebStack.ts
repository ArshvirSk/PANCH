import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
        AMPLIFY_MONOREPO_APP_ROOT: 'web', // Build from /web subdirectory
      },
    });

    amplifyApp.addBranch('main');

    new cdk.CfnOutput(this, 'AmplifyAppId', { value: amplifyApp.appId });
  }
}
