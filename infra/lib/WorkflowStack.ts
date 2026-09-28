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
    // Baseline content policy: misconduct/insults/hate filters on input and
    // output. The PROMPT_ATTACK managed filter was deliberately left out: it
    // false-positives on the tribunal's own anti-injection instructions
    // (verified 2026-09-27 via ApplyGuardrail — the standard judge prompt
    // triggers PROMPT_ATTACK/HIGH GUARDRAIL_INTERVENED, so the model never
    // runs). Injection defense is structural instead: <evidence> envelope,
    // blinded case file, schema-validated outputs, evidence-ID sanitization.
    // services/tribunal/guardrail-config.json can add filters (by type).
    const guardrailConfigPath = path.join(__dirname, '../../services/tribunal/guardrail-config.json');
    let guardrailName = 'PanchGuardrail';
    const baselineFilters: Array<Record<string, string>> = [
      { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
      { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    ];
    let fileFilters: Array<Record<string, string>> = [];
    if (fs.existsSync(guardrailConfigPath)) {
        const config = JSON.parse(fs.readFileSync(guardrailConfigPath, 'utf8'));
        guardrailName = config.name || guardrailName;
        fileFilters = config.contentPolicyConfig?.filtersConfig ?? [];
    }
    // File filters win on type conflicts; the baseline cannot be removed.
    const merged = new Map(baselineFilters.map(f => [f.type, f]));
    for (const f of fileFilters) merged.set(f.type, f);
    const contentPolicyConfig = { filtersConfig: [...merged.values()] };

    const tribunalGuardrail = new bedrock.CfnGuardrail(this, 'TribunalGuardrail', {
      name: guardrailName,
      description: 'Guardrail for AI judges: prompt-attack and misconduct filters on evidence, content filters on rulings',
      contentPolicyConfig: contentPolicyConfig as any,
      blockedInputMessaging: "Blocked input",
      blockedOutputsMessaging: "Blocked output"
    });
    // A versioned guardrail is required to reference it from Converse.
    // Guardrail versions are immutable: editing the CfnGuardrail config does
    // NOT change what an existing version serves. The version resource's id
    // therefore carries a hash of the content policy — any config change
    // creates a NEW version and the Lambda env (GUARDRAIL_VERSION below)
    // follows it. (Verified the hard way: PROMPT_ATTACK was removed from the
    // config but version 1 kept serving it and blocked every judge input.)
    const configHash = require('crypto').createHash('sha256').update(JSON.stringify(contentPolicyConfig)).digest('hex').slice(0, 8);
    const tribunalGuardrailVersion = new bedrock.CfnGuardrailVersion(this, `TribunalGuardrailVersion${configHash}`, {
      guardrailIdentifier: tribunalGuardrail.attrGuardrailId,
      description: `Panch tribunal guardrail, policy ${configHash}`,
    });

    // Bedrock permissions
    const bedrockPolicy = new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/mistral.mistral-large-3-675b-instruct`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.meta.llama3-3-70b-instruct-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/meta.llama3-3-70b-instruct-v1:0`,
        // The us.meta.* cross-region inference profile can route to any of its US
        // destination regions; IAM checks the destination-region foundation model.
        'arn:aws:bedrock:us-east-2::foundation-model/meta.llama3-3-70b-instruct-v1:0',
        'arn:aws:bedrock:us-west-2::foundation-model/meta.llama3-3-70b-instruct-v1:0'
      ]
    });

    const createLambda = (name: string, handlerFile: string) => {
      const fn = new nodejs.NodejsFunction(this, name, {
        entry: path.join(__dirname, '../../services/tribunal/stubs', handlerFile),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          CASES_TABLE: props.dataStack.casesTable.tableName,
          LEDGER_TABLE: props.dataStack.ledgerTable.tableName,
          BUCKET: props.dataStack.evidenceBucket.bucketName,
          RULINGS_TABLE: props.dataStack.rulingsTable.tableName,
          GUARDRAIL_ID: tribunalGuardrail.attrGuardrailId,
          GUARDRAIL_VERSION: tribunalGuardrailVersion.attrVersion,
        },
        // Inline .md prompt imports (judge handlers import '../prompts/judge-N.md?raw').
        // Without this the prompt file would be missing from the flat Lambda bundle.
        bundling: { loader: { '.md': 'text' } },
      });
      fn.addToRolePolicy(bedrockPolicy);
      // Guardrails: every judge call applies the guardrail via Converse.
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [`arn:aws:bedrock:${this.region}:${this.account}:guardrail/${tribunalGuardrail.attrGuardrailId}`],
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/panch/models/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/panch/pricing/bedrock/*`,
        ]
      }));
      // Scoped data-plane access (was: s3/dynamodb/textract on *).
      props.dataStack.casesTable.grantReadData(fn);
      props.dataStack.ledgerTable.grantReadWriteData(fn);
      props.dataStack.evidenceBucket.grantRead(fn);
      props.dataStack.evidenceBucket.grantPut(fn);
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
    // publish.ts writes panch-rulings/{caseId}/ruling.json to the public rulings bucket
    // and the cost record (tokens + costUsd) to the Rulings table.
    props.dataStack.rulingsBucket.grantWrite(publishLambda);
    props.dataStack.rulingsTable.grantWriteData(publishLambda);
    publishLambda.addEnvironment('RULINGS_BUCKET', props.dataStack.rulingsBucket.bucketName);
    const settleLambda = createLambda('SettleLambda', 'settle.ts');
    const failLambda = createLambda('FailLambda', 'failHandler.ts');
    // The rulings bucket is SSE-KMS: PutObject (publish + cached fallback) needs
    // kms:GenerateDataKey/Encrypt, and failHandler's CopyObject also needs Decrypt.
    props.dataStack.kmsKey.grantEncryptDecrypt(publishLambda);
    props.dataStack.kmsKey.grantEncryptDecrypt(failLambda);
    // The cached fallback ruling must land in the RULINGS bucket (the one
    // CloudFront OAC serves) or the ruling page 403s after a failure.
    // failHandler copies bench/demo/{caseId}/fallback-ruling.json from the
    // evidence bucket to panch-rulings/{caseId}/ruling.json here.
    props.dataStack.rulingsBucket.grantWrite(failLambda);
    failLambda.addEnvironment('RULINGS_BUCKET', props.dataStack.rulingsBucket.bucketName);

    // SETTLE appends RESOLVE/RELEASE through the ledger library: a single
    // TransactWriteItems spanning Cases (conditional status flip) + Ledger
    // (hash-chained entry). TransactWriteItems is not part of the standard
    // table grants, so it is granted explicitly on exactly those two tables.
    // The transaction's Update on Cases also checks the per-item
    // dynamodb:UpdateItem permission, so that is granted explicitly too
    // (its absence once failed the RESOLVE transaction silently).
    [props.dataStack.casesTable, props.dataStack.ledgerTable].forEach(t =>
      t.grant(settleLambda, 'dynamodb:TransactWriteItems')
    );
    props.dataStack.casesTable.grant(settleLambda, 'dynamodb:UpdateItem');
    // FAILLambda marks the case FAILED (UpdateItem on Cases) and copies the
    // cached fallback ruling for demo cases.
    props.dataStack.casesTable.grant(failLambda, 'dynamodb:UpdateItem');

    // State Machine Tasks
    const intakeTask = new tasks.LambdaInvoke(this, 'INTAKE', { lambdaFunction: intakeLambda, payloadResponseOnly: true });
    const blindTask = new tasks.LambdaInvoke(this, 'BLIND', { lambdaFunction: blindLambda, payloadResponseOnly: true });
    
    const judgesParallel = new sfn.Parallel(this, 'JUDGES', { resultPath: '$.judges' });
    judgesParallel.branch(new tasks.LambdaInvoke(this, 'Judge1', { lambdaFunction: judge1Lambda, payloadResponseOnly: true }));
    judgesParallel.branch(new tasks.LambdaInvoke(this, 'Judge2', { lambdaFunction: judge2Lambda, payloadResponseOnly: true }));
    judgesParallel.branch(new tasks.LambdaInvoke(this, 'Judge3', { lambdaFunction: judge3Lambda, payloadResponseOnly: true }));

    const prepareCrossExam = new sfn.Pass(this, 'PrepareCrossExam', {
      parameters: {
        'caseId.$': '$.caseId',
        'blindedCaseFileS3Key.$': '$.blindedCaseFileS3Key',
        'peerRulings': {
          'judge-1.$': '$.judges[0].output',
          'judge-2.$': '$.judges[1].output',
          'judge-3.$': '$.judges[2].output'
        },
        // This Pass has no resultPath, so its output REPLACES the state input
        // and $.judges is gone afterwards. Capture each judge's modelId and
        // real Converse token usage here (the only state where $.judges
        // exists) so AGGREGATE can price the case; swapped-forward below.
        'judgesUsage': {
          'judge-1': { 'modelId.$': '$.judges[0].modelId', 'usage.$': '$.judges[0].usage' },
          'judge-2': { 'modelId.$': '$.judges[1].modelId', 'usage.$': '$.judges[1].usage' },
          'judge-3': { 'modelId.$': '$.judges[2].modelId', 'usage.$': '$.judges[2].usage' }
        }
      }
    });

    const crossExamParallel = new sfn.Parallel(this, 'CROSS_EXAM', { resultPath: '$.crossExamOutputs' });
    crossExamParallel.branch(
      new sfn.Pass(this, 'InjectJudge1CE', {
        parameters: { 'judgeName': 'judge-1', 'caseId.$': '$.caseId', 'blindedCaseFileS3Key.$': '$.blindedCaseFileS3Key', 'peerRulings.$': '$.peerRulings' }
      }).next(new tasks.LambdaInvoke(this, 'CrossExamJudge1', { lambdaFunction: crossExamLambda, payloadResponseOnly: true }))
    );
    crossExamParallel.branch(
      new sfn.Pass(this, 'InjectJudge2CE', {
        parameters: { 'judgeName': 'judge-2', 'caseId.$': '$.caseId', 'blindedCaseFileS3Key.$': '$.blindedCaseFileS3Key', 'peerRulings.$': '$.peerRulings' }
      }).next(new tasks.LambdaInvoke(this, 'CrossExamJudge2', { lambdaFunction: crossExamLambda, payloadResponseOnly: true }))
    );
    crossExamParallel.branch(
      new sfn.Pass(this, 'InjectJudge3CE', {
        parameters: { 'judgeName': 'judge-3', 'caseId.$': '$.caseId', 'blindedCaseFileS3Key.$': '$.blindedCaseFileS3Key', 'peerRulings.$': '$.peerRulings' }
      }).next(new tasks.LambdaInvoke(this, 'CrossExamJudge3', { lambdaFunction: crossExamLambda, payloadResponseOnly: true }))
    );

    const swapTestParallel = new sfn.Parallel(this, 'SWAP_TEST', { resultPath: '$.swapOutputsList' });
    swapTestParallel.branch(
      new sfn.Pass(this, 'InjectJudge1ST', {
        parameters: { 'judgeName': 'judge-1', 'caseId.$': '$.caseId', 'blindedCaseFileS3Key.$': '$.blindedCaseFileS3Key', 'isSwapTest': true }
      }).next(new tasks.LambdaInvoke(this, 'SwapTestJudge1', { lambdaFunction: swapTestLambda, payloadResponseOnly: true }))
    );
    swapTestParallel.branch(
      new sfn.Pass(this, 'InjectJudge2ST', {
        parameters: { 'judgeName': 'judge-2', 'caseId.$': '$.caseId', 'blindedCaseFileS3Key.$': '$.blindedCaseFileS3Key', 'isSwapTest': true }
      }).next(new tasks.LambdaInvoke(this, 'SwapTestJudge2', { lambdaFunction: swapTestLambda, payloadResponseOnly: true }))
    );
    swapTestParallel.branch(
      new sfn.Pass(this, 'InjectJudge3ST', {
        parameters: { 'judgeName': 'judge-3', 'caseId.$': '$.caseId', 'blindedCaseFileS3Key.$': '$.blindedCaseFileS3Key', 'isSwapTest': true }
      }).next(new tasks.LambdaInvoke(this, 'SwapTestJudge3', { lambdaFunction: swapTestLambda, payloadResponseOnly: true }))
    );
    
    const prepareAggregate = new sfn.Pass(this, 'PrepareAggregate', {
      parameters: {
        'caseId.$': '$.caseId',
        'blindedCaseFileS3Key.$': '$.blindedCaseFileS3Key',
        'finalPanelOutputs': {
          'judge-1.$': '$.crossExamOutputs[0].output.revisedRuling',
          'judge-2.$': '$.crossExamOutputs[1].output.revisedRuling',
          'judge-3.$': '$.crossExamOutputs[2].output.revisedRuling'
        },
        'swapOutputs': {
          'judge-1.$': '$.swapOutputsList[0].output',
          'judge-2.$': '$.swapOutputsList[1].output',
          'judge-3.$': '$.swapOutputsList[2].output'
        },
        // Judges' original-call usage, captured by PrepareCrossExam while
        // $.judges still existed and swapped forward here. Cross-exam is a
        // pass-through (no model call) so it contributes no usage.
        'judgesUsage.$': '$.judgesUsage',
        'swapUsage': {
          'judge-1': { 'modelId.$': '$.swapOutputsList[0].modelId', 'usage.$': '$.swapOutputsList[0].usage' },
          'judge-2': { 'modelId.$': '$.swapOutputsList[1].modelId', 'usage.$': '$.swapOutputsList[1].usage' },
          'judge-3': { 'modelId.$': '$.swapOutputsList[2].modelId', 'usage.$': '$.swapOutputsList[2].usage' }
        }
      }
    });

    const aggregateTask = new tasks.LambdaInvoke(this, 'AGGREGATE', { lambdaFunction: aggregateLambda, payloadResponseOnly: true });
    
    const failTask = new tasks.LambdaInvoke(this, 'FAILED', { lambdaFunction: failLambda, payloadResponseOnly: true })
      .next(new sfn.Fail(this, 'FailWorkflow', { cause: 'Workflow Failed' }));

    // Escalation now flips the case row to ESCALATED (conditional on
    // DELIBERATING): previously the Route -> ESCALATED branch ended in a
    // Succeed state without touching the row, so escalated cases never
    // appeared in GET /reviews (which scans status = ESCALATED) and their
    // case status stayed DELIBERATING forever.
    const escalateLambda = createLambda('EscalateLambda', 'escalate.ts');
    props.dataStack.casesTable.grant(escalateLambda, 'dynamodb:UpdateItem');
    const escalateTask = new tasks.LambdaInvoke(this, 'ESCALATE', { lambdaFunction: escalateLambda, payloadResponseOnly: true });
    const escalateChain = escalateTask.next(new sfn.Succeed(this, 'ESCALATED', { comment: 'Case Escalated to Human Review' }));
    
    // PRESIDING is payloadResponseOnly and its pass-through handler (Rutu's
    // lane, untouched) returns only { caseId, presidingRulingS3Key, ... }.
    // The AGGREGATE output's usage/costUsd would be dropped, so they are
    // merged back in with a resultPath merge before PUBLISH/SETTLE.
    const presidingTask = new tasks.LambdaInvoke(this, 'PRESIDING', { lambdaFunction: presidingLambda, payloadResponseOnly: true, resultPath: '$.presidingResult' });
    const mergePresiding = new sfn.Pass(this, 'MergePresiding', {
      parameters: {
        'caseId.$': '$.presidingResult.caseId',
        'presidingRulingS3Key.$': '$.presidingResult.presidingRulingS3Key',
        // The synthesized ruling body: without forwarding it here, PUBLISH
        // falls back to the median judge while the award comes from the
        // presiding determination — published award and reasoning would
        // silently disagree.
        'ruling.$': '$.presidingResult.ruling',
        'payeeShareBps.$': '$.presidingResult.payeeShareBps',
        'spreadBps.$': '$.presidingResult.spreadBps',
        'swapConsistent.$': '$.presidingResult.swapConsistent',
        'escalated.$': '$.presidingResult.escalated',
        'blindedCaseFileS3Key.$': '$.presidingResult.blindedCaseFileS3Key',
        'finalPanelOutputs.$': '$.presidingResult.finalPanelOutputs',
        // Per-judge swap results, kept for PUBLISH's panel metadata.
        'swapOutputs.$': '$.swapOutputs',
        'usage.$': '$.usage',
        'costUsd.$': '$.costUsd',
      },
    });
    const presidingChain = presidingTask.next(mergePresiding);
    const publishTask = new tasks.LambdaInvoke(this, 'PUBLISH', { lambdaFunction: publishLambda, payloadResponseOnly: true });
    const settleTask = new tasks.LambdaInvoke(this, 'SETTLE', { lambdaFunction: settleLambda, payloadResponseOnly: true });

    const routeChoice = new sfn.Choice(this, 'Route')
      .when(sfn.Condition.booleanEquals('$.escalated', true), escalateChain)
      .otherwise(presidingChain.next(publishTask).next(settleTask));

    const retryProps = { errors: ['States.ALL'], interval: cdk.Duration.seconds(2), maxAttempts: 3, backoffRate: 2.0 };
    [intakeTask, blindTask, judgesParallel, crossExamParallel, swapTestParallel, aggregateTask, presidingTask, publishTask, settleTask, escalateTask].forEach(t => t.addRetry(retryProps));
    
    [intakeTask, blindTask, judgesParallel, crossExamParallel, swapTestParallel, aggregateTask, presidingTask, publishTask, settleTask, escalateTask].forEach(t => t.addCatch(failTask, { resultPath: '$.error' }));

    const definition = intakeTask
      .next(blindTask)
      .next(judgesParallel)
      .next(prepareCrossExam)
      .next(crossExamParallel)
      .next(swapTestParallel)
      .next(prepareAggregate)
      .next(aggregateTask)
      .next(routeChoice);

    // X-Ray tracing on the state machine (service map + per-stage traces).
    this.stateMachine = new sfn.StateMachine(this, 'TribunalStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
    });
    
    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
  }
}
