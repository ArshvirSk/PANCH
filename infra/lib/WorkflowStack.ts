import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as path from 'path';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as fs from 'fs';

import { DataStack } from './DataStack';

export interface WorkflowStackProps extends cdk.StackProps {
  dataStack: DataStack;
}

export class WorkflowStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
    super(scope, id, props);

    // Initial SSM Parameters for Models
    new ssm.StringParameter(this, 'Judge1Model', { parameterName: '/panch/models/judge-1', stringValue: 'amazon.nova-pro-v1:0' });
    new ssm.StringParameter(this, 'Judge1Mode', { parameterName: '/panch/models/judge-1-mode', stringValue: 'tool' });
    new ssm.StringParameter(this, 'Judge2Model', { parameterName: '/panch/models/judge-2', stringValue: 'mistral.mistral-large-3-675b-instruct' });
    new ssm.StringParameter(this, 'Judge2Mode', { parameterName: '/panch/models/judge-2-mode', stringValue: 'tool' });
    new ssm.StringParameter(this, 'Judge3Model', { parameterName: '/panch/models/judge-3', stringValue: 'us.meta.llama3-3-70b-instruct-v1:0' });
    new ssm.StringParameter(this, 'Judge3Mode', { parameterName: '/panch/models/judge-3-mode', stringValue: 'json' });
    new ssm.StringParameter(this, 'PresidingModel', { parameterName: '/panch/models/presiding', stringValue: 'mistral.mistral-large-3-675b-instruct' });
    new ssm.StringParameter(this, 'PresidingMode', { parameterName: '/panch/models/presiding-mode', stringValue: 'tool' });
    new ssm.StringParameter(this, 'SpreadThreshold', { parameterName: '/panch/config/spread-threshold-bps', stringValue: '3000' });
    new ssm.StringParameter(this, 'MaxCrossExamRounds', { parameterName: '/panch/config/max-crossexam-rounds', stringValue: '2' });

    // Bedrock Guardrail
    // Uses a placeholder config for now; will be swapped for services/tribunal/guardrail-config.json once pushed.
    const guardrailConfigPath = path.join(__dirname, '../../services/tribunal/guardrail-config.json');
    let guardrailName = 'PanchGuardrail';
    let contentPolicyConfig = { filtersConfig: [] };
    if (fs.existsSync(guardrailConfigPath)) {
        const config = JSON.parse(fs.readFileSync(guardrailConfigPath, 'utf8'));
        guardrailName = config.name || guardrailName;
        contentPolicyConfig = config.contentPolicyConfig || contentPolicyConfig;
    }
    
    new bedrock.CfnGuardrail(this, 'TribunalGuardrail', {
      name: guardrailName,
      description: 'Guardrail for AI judges',
      contentPolicyConfig,
      blockedInputMessaging: "Blocked input",
      blockedOutputsMessaging: "Blocked output"
    });

    // Bedrock permissions
    const bedrockPolicy = new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/mistral.mistral-large-3-675b-instruct`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.meta.llama3-3-70b-instruct-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/meta.llama3-3-70b-instruct-v1:0`
      ]
    });

    const createLambda = (name: string, handlerFile: string) => {
      const fn = new nodejs.NodejsFunction(this, name, {
        entry: path.join(__dirname, '../../services/tribunal/stubs', handlerFile),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        environment: {
          CASES_TABLE: props.dataStack.casesTable.tableName,
          LEDGER_TABLE: props.dataStack.ledgerTable.tableName,
          BUCKET: props.dataStack.evidenceBucket.bucketName,
        }
      });
      fn.addToRolePolicy(bedrockPolicy);
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 'textract:*', 'dynamodb:*'],
        resources: ['*'] 
      }));
      return fn;
    };

    const intakeLambda = createLambda('IntakeLambda', 'intake.ts');
    const blindLambda = createLambda('BlindLambda', 'blind.ts');
    const judge1Lambda = createLambda('Judge1Lambda', 'judge-1.ts');
    const judge2Lambda = createLambda('Judge2Lambda', 'judge-2.ts');
    const judge3Lambda = createLambda('Judge3Lambda', 'judge-3.ts');
    const crossExamLambda = createLambda('CrossExamLambda', 'crossExam.ts');
    const swapTestLambda = createLambda('SwapTestLambda', 'swapTest.ts');
    const aggregateLambda = createLambda('AggregateLambda', 'aggregate.ts');
    const presidingLambda = createLambda('PresidingLambda', 'presiding.ts');
    const publishLambda = createLambda('PublishLambda', 'publish.ts');
    const settleLambda = createLambda('SettleLambda', 'settle.ts');
    const failLambda = createLambda('FailLambda', 'failHandler.ts');

    // State Machine Tasks
    const intakeTask = new tasks.LambdaInvoke(this, 'INTAKE', { lambdaFunction: intakeLambda, payloadResponseOnly: true });
    const blindTask = new tasks.LambdaInvoke(this, 'BLIND', { lambdaFunction: blindLambda, payloadResponseOnly: true });
    
    const judgesParallel = new sfn.Parallel(this, 'JUDGES');
    judgesParallel.branch(new tasks.LambdaInvoke(this, 'Judge1', { lambdaFunction: judge1Lambda, payloadResponseOnly: true }));
    judgesParallel.branch(new tasks.LambdaInvoke(this, 'Judge2', { lambdaFunction: judge2Lambda, payloadResponseOnly: true }));
    judgesParallel.branch(new tasks.LambdaInvoke(this, 'Judge3', { lambdaFunction: judge3Lambda, payloadResponseOnly: true }));

    const crossExamTask = new tasks.LambdaInvoke(this, 'CROSS_EXAM', { lambdaFunction: crossExamLambda, payloadResponseOnly: true });
    const swapTestTask = new tasks.LambdaInvoke(this, 'SWAP_TEST', { lambdaFunction: swapTestLambda, payloadResponseOnly: true });
    
    const prepareAggregate = new sfn.Pass(this, 'PrepareAggregate', {
      parameters: {
        'caseId.$': '$.[0].caseId',
        'finalPanelOutputs': {
          'judge-1.$': '$.[0].output',
          'judge-2.$': '$.[1].output',
          'judge-3.$': '$.[2].output'
        }
      }
    });

    const aggregateTask = new tasks.LambdaInvoke(this, 'AGGREGATE', { lambdaFunction: aggregateLambda, payloadResponseOnly: true });
    
    const failTask = new tasks.LambdaInvoke(this, 'FAILED', { lambdaFunction: failLambda, payloadResponseOnly: true })
      .next(new sfn.Fail(this, 'FailWorkflow', { cause: 'Workflow Failed' }));
      
    const escalateTask = new sfn.Succeed(this, 'ESCALATED', { comment: 'Case Escalated to Human Review' });
    
    const presidingTask = new tasks.LambdaInvoke(this, 'PRESIDING', { lambdaFunction: presidingLambda, payloadResponseOnly: true });
    const publishTask = new tasks.LambdaInvoke(this, 'PUBLISH', { lambdaFunction: publishLambda, payloadResponseOnly: true });
    const settleTask = new tasks.LambdaInvoke(this, 'SETTLE', { lambdaFunction: settleLambda, payloadResponseOnly: true });

    const routeChoice = new sfn.Choice(this, 'Route')
      .when(sfn.Condition.booleanEquals('$.escalated', true), escalateTask)
      .otherwise(presidingTask.next(publishTask).next(settleTask));

    const retryProps = { errors: ['States.ALL'], interval: cdk.Duration.seconds(2), maxAttempts: 3, backoffRate: 2.0 };
    [intakeTask, blindTask, crossExamTask, swapTestTask, aggregateTask, presidingTask, publishTask, settleTask].forEach(t => t.addRetry(retryProps));
    
    [intakeTask, blindTask, crossExamTask, swapTestTask, aggregateTask, presidingTask, publishTask, settleTask].forEach(t => t.addCatch(failTask));

    const definition = intakeTask
      .next(blindTask)
      .next(judgesParallel)
      .next(prepareAggregate)
      .next(crossExamTask)
      .next(swapTestTask)
      .next(aggregateTask)
      .next(routeChoice);

    this.stateMachine = new sfn.StateMachine(this, 'TribunalStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30)
    });
    
    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
  }
}
