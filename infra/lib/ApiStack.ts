import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';

export interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.api = new apigw.RestApi(this, 'PanchApi', {
      restApiName: 'Panch Service API',
      defaultCorsPreflightOptions: {
        allowOrigins: ['http://localhost:3000', apigw.Cors.ALL_ORIGINS], // Wil update with Amplify domain once known
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
      deployOptions: {
        tracingEnabled: true,
      }
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'PanchCognitoAuth', {
      cognitoUserPools: [props.userPool],
    });

    // Health Lambda
    const healthLambda = new nodejs.NodejsFunction(this, 'HealthHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../services/api/health.ts'),
    });

    this.api.root.addResource('health').addMethod('GET', new apigw.LambdaIntegration(healthLambda));

    // Stubs for future routes
    const cases = this.api.root.addResource('cases');
    // POST /cases -> Authorizer needed
    cases.addMethod('POST', new apigw.MockIntegration({
      integrationResponses: [{ statusCode: '200' }],
      passthroughBehavior: apigw.PassthroughBehavior.NEVER,
      requestTemplates: { 'application/json': '{"statusCode": 200}' }
    }), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    // Output the API URL
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }
}
