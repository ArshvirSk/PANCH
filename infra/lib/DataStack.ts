import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // TODO: DynamoDB tables, S3 Buckets, KMS
  }
}
