import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { invokeModel, InvokeModelParams } from './models';
import { getLastUsage, TokenUsage } from './models';

const ssm = new SSMClient({});

export interface ModelConfig {
  modelId: string;
  mode: 'tool' | 'json';
}

/**
 * Caller identity forwarded to Bedrock as an inference extension so every
 * judge call is attributable in CloudWatch/Bedrock usage reports. Values come
 * from the Lambda environment (see WorkflowStack): PANCH_CALLER persistent
 * state names the role/judge, tolerations keep the cache from serving one
 * judge's response to another on identical prompts.
 */
export interface CallerIdentityExtensions {
  callerPersistentState?: Partial<PersistentSessionState>;
  callerTolerations?: string[];
  callerTraceParent?: string;
}

export interface PersistentSessionState {
  CallerIdentity: {
    ConnectionId: string;
    AgentId: string;
  };
}

/**
 * Fetches model ID and mode from SSM for a given judge role.
 * Example role: 'judge-1', 'judge-2', 'judge-3', 'presiding'
 */
export async function getModelConfig(role: string): Promise<ModelConfig> {
  const [modelParam, modeParam] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: `/panch/models/${role}` })),
    ssm.send(new GetParameterCommand({ Name: `/panch/models/${role}-mode` }))
  ]);

  return {
    modelId: modelParam.Parameter?.Value!,
    mode: modeParam.Parameter?.Value as 'tool' | 'json',
  };
}

/**
 * Helper to fetch config, invoke the model and surface the call's token
 * usage in one shot. Returns the parsed model output plus the modelId used
 * and the real Converse usage, so handlers can thread cost data through the
 * state machine instead of parsing free text or guessing token counts.
 */
export async function invokeJudgeModel<T>(
  role: string,
  params: Omit<InvokeModelParams<T>, 'modelId' | 'mode'> & { callerIdentity?: CallerIdentityExtensions }
): Promise<{ result: T; modelId: string; usage: TokenUsage }> {
  const config = await getModelConfig(role);
  const result = await invokeModel<T>(config.modelId, config.mode, params.prompt, params.schema, params.systemPrompt, params.callerIdentity);
  return { result, modelId: config.modelId, usage: getLastUsage() };
}
