#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/DataStack';
import { AuthStack } from '../lib/AuthStack';
import { ApiStack } from '../lib/ApiStack';
import { WorkflowStack } from '../lib/WorkflowStack';
import { WebStack } from '../lib/WebStack';
import { ObsStack } from '../lib/ObsStack';

const app = new cdk.App();

// Use current account/region if not specified
const env = { 
  account: process.env.CDK_DEFAULT_ACCOUNT, 
  region: process.env.CDK_DEFAULT_REGION 
};

const dataStack = new DataStack(app, 'PanchDataStack', { env });
const authStack = new AuthStack(app, 'PanchAuthStack', { env });
const apiStack = new ApiStack(app, 'PanchApiStack', { env, userPool: authStack.userPool, dataStack });
const workflowStack = new WorkflowStack(app, 'PanchWorkflowStack', { env });
const webStack = new WebStack(app, 'PanchWebStack', {
  env,
  apiUrl: apiStack.api.url,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});
const obsStack = new ObsStack(app, 'PanchObsStack', { env });
