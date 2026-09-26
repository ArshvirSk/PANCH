import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as path from 'path';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

export class DataStack extends cdk.Stack {
  public readonly casesTable: dynamodb.Table;
  public readonly evidenceTable: dynamodb.Table;
  public readonly rulingsTable: dynamodb.Table;
  public readonly ledgerTable: dynamodb.Table;
  public readonly benchCasesTable: dynamodb.Table;
  public readonly benchRunsTable: dynamodb.Table;

  public readonly evidenceBucket: s3.Bucket;
  public readonly rulingsBucket: s3.Bucket;
  public readonly benchmarkBucket: s3.Bucket;

  public readonly benchmarkBucket: s3.Bucket;

  public readonly kmsKey: kms.Key;
  public readonly rulingsDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. KMS Key
    this.kmsKey = new kms.Key(this, 'PanchKey', {
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pendingWindow: cdk.Duration.days(7),
    });

    // 2. DynamoDB Tables
    this.casesTable = new dynamodb.Table(this, 'Cases', {
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.evidenceTable = new dynamodb.Table(this, 'Evidence', {
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'evidenceId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.rulingsTable = new dynamodb.Table(this, 'Rulings', {
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.ledgerTable = new dynamodb.Table(this, 'Ledger', {
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'seq', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.benchCasesTable = new dynamodb.Table(this, 'BenchCases', {
      partitionKey: { name: 'benchId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.benchRunsTable = new dynamodb.Table(this, 'BenchRuns', {
      partitionKey: { name: 'runId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'benchId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. S3 Buckets
    this.evidenceBucket = new s3.Bucket(this, 'EvidenceBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // Browsers upload evidence straight to S3 with a presigned PUT URL. CORS only lets the page
      // make that request; the 5-minute presigned signature is still what authorizes it.
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
        exposedHeaders: ['ETag'],
        maxAge: 3000,
      }],
    });

    this.rulingsBucket = new s3.Bucket(this, 'RulingsBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // OAC will grant CF access later
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.benchmarkBucket = new s3.Bucket(this, 'BenchmarkBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const oac = new cloudfront.CfnOriginAccessControl(this, 'RulingsOAC', {
      originAccessControlConfig: {
        name: 'RulingsBucketOAC',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      }
    });

    this.rulingsDistribution = new cloudfront.Distribution(this, 'RulingsDist', {
      defaultBehavior: {
        origin: new origins.S3Origin(this.rulingsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      }
    });

    // Override the origin access identity to use OAC instead
    const cfnDist = this.rulingsDistribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDist.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '');
    cfnDist.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.attrId);

    this.rulingsBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [this.rulingsBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: { 'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${this.rulingsDistribution.distributionId}` }
      }
    }));

    this.kmsKey.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringLike: { 'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/*` }
      }
    }));

    // 4. S3 Event Lambda
    const processEvidenceLambda = new nodejs.NodejsFunction(this, 'ProcessEvidenceHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../services/api/processEvidence.ts'),
      environment: { EVIDENCE_TABLE: this.evidenceTable.tableName }
    });
    this.evidenceTable.grantReadWriteData(processEvidenceLambda);
    this.evidenceBucket.grantRead(processEvidenceLambda);
    
    this.evidenceBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processEvidenceLambda)
    );

    // 5. SSM Parameters for Names
    new ssm.StringParameter(this, 'CasesTableNameParam', { parameterName: '/panch/data/tables/cases', stringValue: this.casesTable.tableName });
    new ssm.StringParameter(this, 'EvidenceTableNameParam', { parameterName: '/panch/data/tables/evidence', stringValue: this.evidenceTable.tableName });
    new ssm.StringParameter(this, 'RulingsTableNameParam', { parameterName: '/panch/data/tables/rulings', stringValue: this.rulingsTable.tableName });
    new ssm.StringParameter(this, 'LedgerTableNameParam', { parameterName: '/panch/data/tables/ledger', stringValue: this.ledgerTable.tableName });
    new ssm.StringParameter(this, 'BenchCasesTableNameParam', { parameterName: '/panch/data/tables/benchcases', stringValue: this.benchCasesTable.tableName });
    new ssm.StringParameter(this, 'BenchRunsTableNameParam', { parameterName: '/panch/data/tables/benchruns', stringValue: this.benchRunsTable.tableName });

    new ssm.StringParameter(this, 'EvidenceBucketNameParam', { parameterName: '/panch/data/buckets/evidence', stringValue: this.evidenceBucket.bucketName });
    new ssm.StringParameter(this, 'RulingsBucketNameParam', { parameterName: '/panch/data/buckets/rulings', stringValue: this.rulingsBucket.bucketName });
    new ssm.StringParameter(this, 'BenchmarkBucketNameParam', { parameterName: '/panch/data/buckets/benchmark', stringValue: this.benchmarkBucket.bucketName });
    
    new ssm.StringParameter(this, 'KmsKeyArnParam', { parameterName: '/panch/data/kms/keyArn', stringValue: this.kmsKey.keyArn });
  }
}
