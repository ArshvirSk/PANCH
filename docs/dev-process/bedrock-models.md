# Bedrock Models Setup

**Region:** `us-east-1`

## Chosen Models (Judge Panel)

1. **Judge 1 (Amazon):** `amazon.nova-pro-v1:0`
2. **Judge 2 (Mistral):** `mistral.mistral-large-3-675b-instruct`
3. **Judge 3 (Meta):** `us.meta.llama3-3-70b-instruct-v1:0`

**Presiding Judge Recommendation:** `us.meta.llama3-3-70b-instruct-v1:0`
*(Llama 3.3 70B is the strongest reasoning model among the passing candidates while Anthropic is blocked).*

*Note: Since Anthropic is inaccessible, we are using 3 non-Anthropic families (Amazon, Mistral, Meta).*

## Test Results

| Model ID | Plain Prompt | Tool Use | Latency (~500 tokens) |
| :--- | :--- | :--- | :--- |
| `us.meta.llama3-3-70b-instruct-v1:0` | **OK** | **FAILED*** | 1876 ms |
| `amazon.nova-pro-v1:0` | **OK** | **OK** | 3199 ms |
| `mistral.mistral-large-3-675b-instruct` | **OK** | **OK** | 989 ms |
| `us.deepseek.r1-v1:0` | **OK** | **FAILED** | N/A |

*\* Llama 3.3 70B fails when forced with `toolChoice` but successfully returns strict JSON when requested via a plain prompt. We will use plain prompt + JSON for Llama.*

## Quotas (Current Values)

| Quota Name | Value |
| :--- | :--- |
| On-demand model inference requests per minute for Amazon Nova Pro | 25.0 |
| On-demand model inference tokens per minute for Amazon Nova Pro | 1,000,000.0 |
| On-demand model inference requests per minute for Mistral Large 3 | 1,000.0 |
| On-demand model inference tokens per minute for Mistral Large 3 | 100,000,000.0 |
| Cross-region model inference requests per minute for Meta Llama 3.3 70B Instruct | 80.0 |
| Cross-region model inference tokens per minute for Meta Llama 3.3 70B Instruct | 600,000.0 |

## Blocked Models
- **Anthropic Claude models (`us.anthropic.claude-opus-4-7`, `us.anthropic.claude-sonnet-4-5...`)**: 
  - `ValidationException: Access to Anthropic models is not allowed for this account.`
- **Amazon Nova Premier (`us.amazon.nova-premier-v1:0`)**:
  - `ResourceNotFoundException: This model version has reached the end of its life.`

## Retest Later
Once Anthropic model access is approved in the AWS Console (via the *Model access* page -> *Submit use case details*), we should retest and replace one of the judges or the presiding judge with:
- `us.anthropic.claude-opus-4-7`
- `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
- `us.anthropic.claude-3-haiku-20240307-v1:0`
