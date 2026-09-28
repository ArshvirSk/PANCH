import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { DataStack } from './DataStack';
import { WorkflowStack } from './WorkflowStack';

export interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  // Used by the GET /cases/{id} Lambda-side JWT check for non-demo cases
  // (the route itself is public so demo cases stay readable logged out).
  userPoolClient: cognito.UserPoolClient;
  dataStack: DataStack;
  workflowStack: WorkflowStack;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.api = new apigw.RestApi(this, 'PanchApi', {
      restApiName: 'Panch Service API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
      deployOptions: { 
        tracingEnabled: true,
        methodOptions: {
          '/demo/run/POST': {
            throttlingRateLimit: 2,
            throttlingBurstLimit: 5
          }
        }
      }
    });

    const corsErrorHeaders = { 'Access-Control-Allow-Origin': "'*'", 'Access-Control-Allow-Headers': "'*'" };
    this.api.addGatewayResponse('Default4xx', { type: apigw.ResponseType.DEFAULT_4XX, responseHeaders: corsErrorHeaders });
    this.api.addGatewayResponse('Default5xx', { type: apigw.ResponseType.DEFAULT_5XX, responseHeaders: corsErrorHeaders });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'PanchCognitoAuth', {
      cognitoUserPools: [props.userPool],
    });

    // Health Lambda
    const healthLambda = new nodejs.NodejsFunction(this, 'HealthHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../services/api/health.ts'),
      tracing: lambda.Tracing.ACTIVE,
    });
    this.api.root.addResource('health').addMethod('GET', new apigw.LambdaIntegration(healthLambda));

    const cases = this.api.root.addResource('cases');
    const caseId = cases.addResource('{id}');

    const createCaseLambda = new nodejs.NodejsFunction(this, 'CreateCaseHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'create',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName }
    });
    props.dataStack.casesTable.grantReadWriteData(createCaseLambda);
    cases.addMethod('POST', new apigw.LambdaIntegration(createCaseLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    const getCaseLambda = new nodejs.NodejsFunction(this, 'GetCaseHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getCase',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        CASES_TABLE: props.dataStack.casesTable.tableName,
        // JWT verification for non-demo cases (the method is public; demo cases
        // are readable logged out, everything else requires a valid ID token).
        USER_POOL_ID: props.userPool.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
      },
    });
    props.dataStack.casesTable.grantReadData(getCaseLambda);
    getCaseLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:DescribeExecution', 'states:GetExecutionHistory'],
      resources: [
        props.workflowStack.stateMachine.stateMachineArn,
        // Executions live under 'arn:...:execution:<name>:<execId>'. The :* wildcard is
        // required or every stage lookup is AccessDenied (silently swallowed by the
        // Lambda's catch). The name is pulled from the ARN token with Fn.split/Fn.select
        // because tokens cannot be string-manipulated at synth time.
        cdk.Arn.format({
          service: 'states',
          resource: 'execution',
          resourceName: `${cdk.Fn.select(6, cdk.Fn.split(':', props.workflowStack.stateMachine.stateMachineArn))}:*`,
          arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
        }, this),
      ]
    }));
    // Public read (no Cognito): the ship gate (PRD F10) requires a logged-out visitor to
    // run /demo/run and poll the case to its ruling. This is a read-only mirror of the
    // already-public GET /rulings/{id}; the Lambda trims party identifiers for
    // unauthenticated callers, so no personal data is exposed. All mutating /cases
    // routes stay Cognito-authorized.
    caseId.addMethod('GET', new apigw.LambdaIntegration(getCaseLambda));

    const fundLambda = new nodejs.NodejsFunction(this, 'FundHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'fund',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName, LEDGER_TABLE: props.dataStack.ledgerTable.tableName }
    });
    props.dataStack.casesTable.grantReadWriteData(fundLambda);
    props.dataStack.ledgerTable.grantReadWriteData(fundLambda);
    caseId.addResource('fund').addMethod('POST', new apigw.LambdaIntegration(fundLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    const disputeLambda = new nodejs.NodejsFunction(this, 'DisputeHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dispute',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName, LEDGER_TABLE: props.dataStack.ledgerTable.tableName }
    });
    props.dataStack.casesTable.grantReadWriteData(disputeLambda);
    props.dataStack.ledgerTable.grantReadWriteData(disputeLambda);
    caseId.addResource('dispute').addMethod('POST', new apigw.LambdaIntegration(disputeLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    const evidenceLambda = new nodejs.NodejsFunction(this, 'EvidenceUrlHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'evidenceUrl',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: { EVIDENCE_BUCKET: props.dataStack.evidenceBucket.bucketName }
    });
    props.dataStack.evidenceBucket.grantPut(evidenceLambda);
    caseId.addResource('evidence').addMethod('POST', new apigw.LambdaIntegration(evidenceLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });
    
    const submitLambda = new nodejs.NodejsFunction(this, 'SubmitHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'submit',
      entry: path.join(__dirname, '../../services/api/cases.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName, STATE_MACHINE_ARN: props.workflowStack.stateMachine.stateMachineArn }
    });
    props.dataStack.casesTable.grantReadWriteData(submitLambda);
    submitLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: [props.workflowStack.stateMachine.stateMachineArn]
    }));
    caseId.addResource('submit').addMethod('POST', new apigw.LambdaIntegration(submitLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    // Reviews (Human Review API)
    const reviews = this.api.root.addResource('reviews');
    const getReviewsLambda = new nodejs.NodejsFunction(this, 'GetReviewsHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getReviews',
      entry: path.join(__dirname, '../../services/api/reviews.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        CASES_TABLE: props.dataStack.casesTable.tableName,
        // Legacy escalated rows (pre-panel-record) recover their panel from
        // the case's execution history.
        STATE_MACHINE_ARN: props.workflowStack.stateMachine.stateMachineArn,
      }
    });
    props.dataStack.casesTable.grantReadData(getReviewsLambda);
    // Panel-record recovery reads execution history (read-only).
    // GetExecutionHistory authorizes against the EXECUTION ARN, not the state
    // machine ARN, so the machine ARN alone silently denies every call
    // (AccessDenied, swallowed by the recovery catch). Same shape as the
    // GET /cases/{id} grant above.
    getReviewsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:GetExecutionHistory'],
      resources: [
        cdk.Arn.format({
          service: 'states',
          resource: 'execution',
          resourceName: `${cdk.Fn.select(6, cdk.Fn.split(':', props.workflowStack.stateMachine.stateMachineArn))}:*`,
          arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
        }, this),
      ],
    }));
    reviews.addMethod('GET', new apigw.LambdaIntegration(getReviewsLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    const postReviewLambda = new nodejs.NodejsFunction(this, 'PostReviewHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'postReview',
      entry: path.join(__dirname, '../../services/api/reviews.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        CASES_TABLE: props.dataStack.casesTable.tableName,
        LEDGER_TABLE: props.dataStack.ledgerTable.tableName,
        RULINGS_TABLE: props.dataStack.rulingsTable.tableName,
        RULINGS_BUCKET: props.dataStack.rulingsBucket.bucketName,
      }
    });
    props.dataStack.casesTable.grantReadWriteData(postReviewLambda);
    props.dataStack.ledgerTable.grantReadWriteData(postReviewLambda);
    // postReview settles through the ledger library: TransactWriteItems spans
    // Cases + Ledger in one transaction (not in the standard table grants).
    [props.dataStack.casesTable, props.dataStack.ledgerTable].forEach(t =>
      t.grant(postReviewLambda, 'dynamodb:TransactWriteItems')
    );
    // Human rulings get the same durable record as AI ones: a published body
    // in the rulings bucket (SSE-KMS: PutObject also needs the KMS grant) and
    // a Rulings table row so the gallery lists it and /verify can run.
    props.dataStack.rulingsTable.grantWriteData(postReviewLambda);
    props.dataStack.rulingsBucket.grantWrite(postReviewLambda);
    props.dataStack.kmsKey.grantEncryptDecrypt(postReviewLambda);
    reviews.addResource('{caseId}').addMethod('POST', new apigw.LambdaIntegration(postReviewLambda), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO });

    // Rulings
    const rulings = this.api.root.addResource('rulings');
    const getRulingsLambda = new nodejs.NodejsFunction(this, 'GetRulingsHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getRulings',
      entry: path.join(__dirname, '../../services/api/rulings.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: { 
        RULINGS_TABLE: props.dataStack.rulingsTable.tableName,
        RULINGS_DOMAIN: props.dataStack.rulingsDistribution.distributionDomainName
      }
    });
    // Read scope is the Rulings table only: the gallery lists published
    // rulings from there (it used to scan Cases for the transient RULED
    // status, which is why it was always empty).
    props.dataStack.rulingsTable.grantReadData(getRulingsLambda);
    rulings.addMethod('GET', new apigw.LambdaIntegration(getRulingsLambda));

    const getRulingByIdLambda = new nodejs.NodejsFunction(this, 'GetRulingByIdHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getRulingById',
      entry: path.join(__dirname, '../../services/api/rulings.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        RULINGS_TABLE: props.dataStack.rulingsTable.tableName,
        RULINGS_DOMAIN: props.dataStack.rulingsDistribution.distributionDomainName
      }
    });
    props.dataStack.rulingsTable.grantReadData(getRulingByIdLambda);
    const rulingId = rulings.addResource('{id}');
    rulingId.addMethod('GET', new apigw.LambdaIntegration(getRulingByIdLambda));

    const verifyRulingLambda = new nodejs.NodejsFunction(this, 'VerifyRulingHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'verifyRuling',
      entry: path.join(__dirname, '../../services/api/rulings.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        RULINGS_TABLE: props.dataStack.rulingsTable.tableName,
        LEDGER_TABLE: props.dataStack.ledgerTable.tableName,
        RULINGS_DOMAIN: props.dataStack.rulingsDistribution.distributionDomainName,
      }
    });
    // Verify reads the Rulings metadata + the case's ledger entries; it is
    // strictly read-only.
    props.dataStack.rulingsTable.grantReadData(verifyRulingLambda);
    props.dataStack.ledgerTable.grantReadData(verifyRulingLambda);
    rulingId.addResource('verify').addMethod('GET', new apigw.LambdaIntegration(verifyRulingLambda));

    // Demo
    const demoLambda = new nodejs.NodejsFunction(this, 'DemoRunHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'runDemo',
      entry: path.join(__dirname, '../../services/api/demo.ts'),
      tracing: lambda.Tracing.ACTIVE,
      environment: { CASES_TABLE: props.dataStack.casesTable.tableName, STATE_MACHINE_ARN: props.workflowStack.stateMachine.stateMachineArn, BUCKET: props.dataStack.evidenceBucket.bucketName }
    });
    props.dataStack.casesTable.grantReadWriteData(demoLambda);
    // The demo seeds its contract text into the evidence bucket (KMS-encrypted).
    props.dataStack.evidenceBucket.grantWrite(demoLambda);
    props.dataStack.kmsKey.grantEncryptDecrypt(demoLambda);
    demoLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: [props.workflowStack.stateMachine.stateMachineArn]
    }));
    this.api.root.addResource('demo').addResource('run').addMethod('POST', new apigw.LambdaIntegration(demoLambda));

    // Output the API URL
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }
}
