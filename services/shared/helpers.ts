import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { invokeModel, InvokeModelParams } from './models';

const ssm = new SSMClient({});

export interface ModelConfig {
  modelId: string;
  mode: 'tool' | 'json';
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
 * Helper to fetch config and invoke the model in one shot.
 */
export async function invokeJudgeModel<T>(
  role: string,
  params: Omit<InvokeModelParams<T>, 'modelId' | 'mode'>
): Promise<T> {
  const config = await getModelConfig(role);
  return invokeModel<T>(config.modelId, config.mode, params.prompt, params.schema, params.systemPrompt);
}
