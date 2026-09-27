import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface ObsStackProps extends cdk.StackProps {
  /** Full ARN of the tribunal state machine (AWS/States dimension is the ARN). */
  stateMachineArn: string;
  /** REST API name (AWS/ApiGateway 5XXError dimension). */
  apiName: string;
  /** CloudFront distribution id for the rulings path (Requests metric). */
  distributionId: string;
}

// Prices are USD per 1,000 tokens from the AWS Bedrock price list. They live
// in SSM (not code) so updating a price or swapping a judge model never
// touches Lambda or CDK. Parameter names must match services/shared/cost.ts
// pricingParamName() (SSM forbids ':' and '.', so model ids are slugified).
const BEDROCK_PRICES: Array<{ modelId: string; inputPer1k: string; outputPer1k: string }> = [
  { modelId: 'amazon.nova-pro-v1:0', inputPer1k: '0.0008', outputPer1k: '0.0032' },
  { modelId: 'mistral.mistral-large-3-675b-instruct', inputPer1k: '0.003', outputPer1k: '0.009' },
  { modelId: 'us.meta.llama3-3-70b-instruct-v1:0', inputPer1k: '0.00072', outputPer1k: '0.00072' },
];

function pricingParamName(modelId: string, kind: 'input' | 'output'): string {
  const slug = modelId.replace(/[^a-zA-Z0-9]/g, '_');
  return `/panch/pricing/bedrock/${slug}-${kind}`;
}

export class ObsStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObsStackProps) {
    super(scope, id, props);

    // --- Bedrock price table in SSM (kept in config, not code) ---
    for (const p of BEDROCK_PRICES) {
      new ssm.StringParameter(this, `Price${p.modelId.replace(/[^a-zA-Z0-9]/g, '')}In`, {
        parameterName: pricingParamName(p.modelId, 'input'),
        stringValue: p.inputPer1k,
        description: `Panch: ${p.modelId} input price, USD per 1,000 tokens`,
      });
      new ssm.StringParameter(this, `Price${p.modelId.replace(/[^a-zA-Z0-9]/g, '')}Out`, {
        parameterName: pricingParamName(p.modelId, 'output'),
        stringValue: p.outputPer1k,
        description: `Panch: ${p.modelId} output price, USD per 1,000 tokens`,
      });
    }

    // --- Alarm fan-out topic ---
    this.alarmTopic = new sns.Topic(this, 'PanchAlarms', {
      topicName: 'panch-alarms',
      displayName: 'Panch alarms',
    });

    // --- Metrics ---
    const executionsStarted = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsStarted',
      dimensionsMap: { StateMachineArn: props.stateMachineArn },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });
    const executionsSucceeded = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsSucceeded',
      dimensionsMap: { StateMachineArn: props.stateMachineArn },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });
    const executionsFailed = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsFailed',
      dimensionsMap: { StateMachineArn: props.stateMachineArn },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // Stage durations: the tribunal Lambdas emit Panch.StageDuration (EMF via
    // services/shared/metrics.ts) dimensioned by Stage and CaseId.
    const stageDurations = new cloudwatch.MathExpression({
      expression: 'SEARCH(\'{Panch,Stage,CaseId} StageDuration\', \'Average\', 300)',
      usingMetrics: {},
      period: cdk.Duration.minutes(5),
      label: 'stage duration (avg ms)',
    });

    const bedrockInputTokens = new cloudwatch.Metric({
      namespace: 'AWS/Bedrock',
      metricName: 'InputTokenCount',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });
    const bedrockOutputTokens = new cloudwatch.Metric({
      namespace: 'AWS/Bedrock',
      metricName: 'OutputTokenCount',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });
    const bedrockThrottles = new cloudwatch.Metric({
      namespace: 'AWS/Bedrock',
      metricName: 'InvocationThrottles',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const demoRuns = new cloudwatch.Metric({
      namespace: 'Panch',
      metricName: 'DemoRuns',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api5xx = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: { ApiName: props.apiName, Stage: 'prod' },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // /reviews usage: the review Lambdas emit Panch.ReviewActions (EMF).
    const reviewActions = new cloudwatch.Metric({
      namespace: 'Panch',
      metricName: 'ReviewActions',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const rulingRequests = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: 'Requests',
      dimensionsMap: { DistributionId: props.distributionId, Region: 'Global' },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // --- Dashboard ---
    const dashboard = new cloudwatch.Dashboard(this, 'PanchDashboard', {
      dashboardName: 'Panch-Demo',
    });

    dashboard.addWidgets(
      new cloudwatch.Row(
        new cloudwatch.GraphWidget({
          title: 'Tribunal executions (started / succeeded / failed)',
          left: [executionsStarted, executionsSucceeded, executionsFailed],
          leftYAxis: { min: 0 },
        }),
        new cloudwatch.GraphWidget({
          title: 'Stage durations (avg ms, per stage)',
          left: [stageDurations],
        }),
      ),
      new cloudwatch.Row(
        new cloudwatch.GraphWidget({
          title: 'Bedrock tokens (account-wide input/output + per-case panel)',
          left: [bedrockInputTokens, bedrockOutputTokens],
          right: [
            new cloudwatch.Metric({
              namespace: 'Panch',
              metricName: 'BedrockTokens',
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
              label: 'per-case tokens (Panch)',
            }),
          ],
        }),
        new cloudwatch.GraphWidget({
          title: 'Bedrock throttles',
          left: [bedrockThrottles],
          leftYAxis: { min: 0 },
        }),
      ),
      new cloudwatch.Row(
        new cloudwatch.GraphWidget({
          title: '/demo/run starts',
          left: [demoRuns],
          leftYAxis: { min: 0 },
        }),
        new cloudwatch.GraphWidget({
          title: 'API 5XX errors',
          left: [api5xx],
          leftYAxis: { min: 0 },
        }),
        new cloudwatch.GraphWidget({
          title: '/reviews usage',
          left: [reviewActions],
          leftYAxis: { min: 0 },
        }),
        new cloudwatch.GraphWidget({
          title: 'Rulings CloudFront requests',
          left: [rulingRequests],
          leftYAxis: { min: 0 },
        }),
      ),
    );

    // --- Alarms ---
    const mkAlarm = (metric: cloudwatch.IMetric, id: string, threshold: number, description: string) => {
      const alarm = new cloudwatch.Alarm(this, id, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      });
      alarm.addAlarmAction(new cwActions.SnsAction(this.alarmTopic));
      return alarm;
    };

    mkAlarm(
      executionsFailed,
      'TribunalExecutionsFailedAlarm',
      1,
      'A tribunal execution reached FAILED (Catch path fired or workflow error)',
    );
    mkAlarm(
      api5xx,
      'Api5xxAlarm',
      5,
      'Panch API returned >=5 server errors in 5 minutes',
    );
    mkAlarm(
      bedrockThrottles,
      'BedrockThrottlesAlarm',
      1,
      'Bedrock throttled at least one judge invocation in 5 minutes',
    );

    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
    new cdk.CfnOutput(this, 'DashboardName', { value: dashboard.dashboardName });
  }
}
