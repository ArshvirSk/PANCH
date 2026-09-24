import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';

export class WorkflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Initial SSM Parameters for Models
    new ssm.StringParameter(this, 'Judge1Model', {
      parameterName: '/panch/models/judge-1',
      stringValue: 'amazon.nova-pro-v1:0',
    });
    new ssm.StringParameter(this, 'Judge1Mode', {
      parameterName: '/panch/models/judge-1-mode',
      stringValue: 'tool',
    });

    new ssm.StringParameter(this, 'Judge2Model', {
      parameterName: '/panch/models/judge-2',
      stringValue: 'mistral.mistral-large-3-675b-instruct',
    });
    new ssm.StringParameter(this, 'Judge2Mode', {
      parameterName: '/panch/models/judge-2-mode',
      stringValue: 'tool',
    });

    new ssm.StringParameter(this, 'Judge3Model', {
      parameterName: '/panch/models/judge-3',
      stringValue: 'us.meta.llama3-3-70b-instruct-v1:0',
    });
    new ssm.StringParameter(this, 'Judge3Mode', {
      parameterName: '/panch/models/judge-3-mode',
      stringValue: 'json',
    });

    new ssm.StringParameter(this, 'PresidingModel', {
      parameterName: '/panch/models/presiding',
      stringValue: 'mistral.mistral-large-3-675b-instruct',
    });
    new ssm.StringParameter(this, 'PresidingMode', {
      parameterName: '/panch/models/presiding-mode',
      stringValue: 'tool',
    });

    // Config parameters
    new ssm.StringParameter(this, 'SpreadThreshold', {
      parameterName: '/panch/config/spread-threshold-bps',
      stringValue: '3000',
    });
    
    new ssm.StringParameter(this, 'MaxCrossExamRounds', {
      parameterName: '/panch/config/max-crossexam-rounds',
      stringValue: '2',
    });

    // IAM Role snippet example for later
    const bedrockPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
          resources: [
            `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
            `arn:aws:bedrock:${this.region}::foundation-model/mistral.mistral-large-3-675b-instruct`,
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.meta.llama3-3-70b-instruct-v1:0`,
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.mistral.mistral-large-3-675b-instruct`
          ]
        })
      ]
    });
    // TODO: Attach this to Step Functions / Lambda execution role when created
  }
}
