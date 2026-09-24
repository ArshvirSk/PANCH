import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';
import { DataStack } from './DataStack';

export interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  dataStack: DataStack;
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
      entry: path.join(__dirname, '../../services/api/health.ts'),
    });

    this.api.root.addResource('health').addMethod('GET', new apigw.LambdaIntegration(healthLambda));

    const cases = this.api.root.addResource('cases');
    const caseId = cases.addResource('{id}');

    // POST /cases
    const createCaseLambda = new nodejs.NodejsFunction(this, 'CreateCaseHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'create',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName }
    });
    props.dataStack.casesTable.grantReadWriteData(createCaseLambda);
    cases.addMethod('POST', new apigw.LambdaIntegration(createCaseLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    // GET /cases/{id}
    const getCaseLambda = new nodejs.NodejsFunction(this, 'GetCaseHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getCase',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName }
    });
    props.dataStack.casesTable.grantReadData(getCaseLambda);
    caseId.addMethod('GET', new apigw.LambdaIntegration(getCaseLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    // POST /cases/{id}/fund
    const fundLambda = new nodejs.NodejsFunction(this, 'FundHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'fund',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName, LEDGER_TABLE: props.dataStack.ledgerTable.tableName }
    });
    props.dataStack.casesTable.grantReadWriteData(fundLambda);
    props.dataStack.ledgerTable.grantReadWriteData(fundLambda);
    caseId.addResource('fund').addMethod('POST', new apigw.LambdaIntegration(fundLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    // POST /cases/{id}/dispute
    const disputeLambda = new nodejs.NodejsFunction(this, 'DisputeHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dispute',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName, LEDGER_TABLE: props.dataStack.ledgerTable.tableName }
    });
    props.dataStack.casesTable.grantReadWriteData(disputeLambda);
    props.dataStack.ledgerTable.grantReadWriteData(disputeLambda);
    caseId.addResource('dispute').addMethod('POST', new apigw.LambdaIntegration(disputeLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    // POST /cases/{id}/evidence
    const evidenceLambda = new nodejs.NodejsFunction(this, 'EvidenceUrlHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'evidenceUrl',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      environment: { EVIDENCE_BUCKET: props.dataStack.evidenceBucket.bucketName }
    });
    props.dataStack.evidenceBucket.grantPut(evidenceLambda);
    caseId.addResource('evidence').addMethod('POST', new apigw.LambdaIntegration(evidenceLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });
    
    // POST /cases/{id}/submit
    const submitLambda = new nodejs.NodejsFunction(this, 'SubmitHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'submit',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName }
    });
    props.dataStack.casesTable.grantReadWriteData(submitLambda);
    caseId.addResource('submit').addMethod('POST', new apigw.LambdaIntegration(submitLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    // Stubs
    const publicStubsLambda = new nodejs.NodejsFunction(this, 'PublicStubsHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getRuling',
      entry: path.join(__dirname, '../../services/api/publicStubs.ts'),
    });
    
    this.api.root.addResource('rulings').addResource('{id}').addMethod('GET', new apigw.LambdaIntegration(publicStubsLambda));
    this.api.root.addResource('demo').addResource('run').addMethod('POST', new apigw.LambdaIntegration(new nodejs.NodejsFunction(this, 'DemoRun', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'demoRun',
      entry: path.join(__dirname, '../../services/api/publicStubs.ts'),
    })));
    this.api.root.addResource('bench').addResource('summary').addMethod('GET', new apigw.LambdaIntegration(new nodejs.NodejsFunction(this, 'BenchSummary', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getBenchSummary',
      entry: path.join(__dirname, '../../services/api/publicStubs.ts'),
    })));

    // Output the API URL
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }
}
