/**
 * Unity Catalog "model service" provider (Databricks Unity Gateway).
 *
 * Invokes a UC model service via the Unity Gateway's OpenAI-compatible
 * chat-completions endpoint:
 *   POST https://<host>/ai-gateway/mlflow/v1/chat/completions
 * The 3-part UC model-service name (e.g. "system.ai.claude-sonnet-4-5") is
 * sent in the request BODY as "model" -- not the URL path, unlike classic
 * per-endpoint invocation URLs. See
 * https://docs.databricks.com/aws/en/ai-gateway/query-model-services.
 *
 * Auth: prefer the end user's forwarded token (`x-forwarded-access-token`,
 * threaded through via streamText's `headers` option), else fall back to
 * the app service principal's token.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getDatabricksToken } from '@chat-template/auth';
import { getWorkspaceHostname } from './providers-server';

// Mirrors the removed getProviderToken() in providers-server.ts.
async function getFallbackToken(): Promise<string> {
  if (process.env.DATABRICKS_TOKEN) {
    return process.env.DATABRICKS_TOKEN;
  }
  return getDatabricksToken();
}

/**
 * Builds a Vercel AI SDK LanguageModel that talks to a Unity Catalog model
 * service via the Unity Gateway's OpenAI-compatible chat-completions endpoint.
 */
export async function getModelServiceLanguageModel(
  modelServiceName: string | undefined = process.env.DATABRICKS_MODEL_SERVICE,
) {
  if (!modelServiceName) {
    throw new Error(
      'Please set the DATABRICKS_MODEL_SERVICE environment variable to a ' +
        '3-part Unity Catalog model-service name (e.g. "system.ai.claude-sonnet-4-5")',
    );
  }

  const host = await getWorkspaceHostname();

  const provider = createOpenAICompatible({
    name: 'databricks-model-service',
    baseURL: `${host}/ai-gateway/mlflow/v1`,
    fetch: async (...[input, init]: Parameters<typeof fetch>) => {
      const headers = new Headers(init?.headers);

      const userToken = headers.get('x-forwarded-access-token');
      if (userToken) {
        headers.set('Authorization', `Bearer ${userToken}`);
      } else {
        headers.set('Authorization', `Bearer ${await getFallbackToken()}`);
      }

      return fetch(input, { ...init, headers });
    },
  });

  // createOpenAICompatible's `.chatModel(id)` builds request bodies of the
  // shape { model: id, messages: [...], ... } and POSTs to
  // `${baseURL}/chat/completions`, which lines up with the documented
  // `/ai-gateway/mlflow/v1/chat/completions` path given the baseURL above.
  return provider.chatModel(modelServiceName);
}
