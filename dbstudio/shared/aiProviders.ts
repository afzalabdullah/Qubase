// AI providers the assistant can use. Everything except Anthropic speaks the OpenAI chat API.

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'kimi' | 'ollama' | 'ollama-cloud' | 'groq' | 'openrouter' | 'custom'

export interface AiProviderInfo {
  id: AiProvider
  label: string
  /** OpenAI-compatible base URL (ends before /chat/completions) */
  baseUrl?: string
  needsKey: boolean
  keyHint?: string
  keyUrl?: string
  defaultModel: string
  /** Suggestions; any model name can be typed, and "Load models" asks the provider */
  models: string[]
  note?: string
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', needsKey: true, keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  { id: 'openai', label: 'OpenAI (ChatGPT / Codex)', baseUrl: 'https://api.openai.com/v1', needsKey: true, keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5', models: ['gpt-5', 'gpt-5-mini', 'gpt-5-codex', 'gpt-4.1'] },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-pro', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { id: 'kimi', label: 'Kimi (Moonshot AI)', baseUrl: 'https://api.moonshot.ai/v1', needsKey: true, keyHint: 'sk-…', keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    defaultModel: 'kimi-k2-0905-preview', models: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'moonshot-v1-32k'] },
  { id: 'ollama', label: 'Ollama (local, free)', baseUrl: 'http://localhost:11434/v1', needsKey: false,
    defaultModel: 'qwen2.5-coder:7b', models: ['qwen2.5-coder:7b', 'qwen2.5-coder:3b', 'qwen2.5-coder:14b', 'llama3.1:8b', 'llama3.2:3b', 'sqlcoder:7b', 'deepseek-coder-v2:16b'],
    note: 'Free with no account or limits: the model runs on your computer and nothing leaves it. Install Ollama (ollama.com/download), run "ollama pull qwen2.5-coder:7b" (about 5 GB, needs ~8 GB RAM; use qwen2.5-coder:3b on smaller PCs), then press Load models. Models ending in "-cloud" run on Ollama Cloud (free plan with limits) after "ollama signin".' },
  { id: 'ollama-cloud', label: 'Ollama Cloud', baseUrl: 'https://ollama.com/v1', needsKey: true, keyHint: 'Ollama API key', keyUrl: 'https://ollama.com/settings/keys',
    defaultModel: 'gpt-oss:120b', models: ['gpt-oss:120b', 'gpt-oss:20b', 'qwen3-coder:480b', 'deepseek-v3.1:671b', 'kimi-k2:1t'],
    note: 'Models hosted by Ollama, no GPU needed. The free plan covers many cloud models with hourly/weekly limits; the largest (premium) models need credits or a plan. If one says payment is needed, pick another model or wait for the limit to reset. Unlimited and offline: Ollama (local). Alternative: sign in with "ollama signin" and use a "-cloud" model (e.g. gpt-oss:120b-cloud) through the local Ollama option.' },
  { id: 'groq', label: 'Groq (very fast)', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, keyHint: 'gsk_…', keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3-32b', 'moonshotai/kimi-k2-instruct', 'llama-3.1-8b-instant'],
    note: 'Free API key with rate limits (requests and tokens per minute/day); answers come back in about a second. Press Load models for the current list.' },
  { id: 'openrouter', label: 'OpenRouter (many models)', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'openai/gpt-5', models: ['openai/gpt-5', 'google/gemini-2.5-pro', 'moonshotai/kimi-k2', 'deepseek/deepseek-chat'] },
  { id: 'custom', label: 'Other (OpenAI-compatible)', baseUrl: 'http://localhost:1234/v1', needsKey: false,
    defaultModel: '', models: [], note: 'Any server with an OpenAI-style /chat/completions endpoint: LM Studio, vLLM, LocalAI, Azure OpenAI, DeepSeek, Groq, Mistral…' }
]

/** Provider info; an unknown id (e.g. from a newer version's settings) is treated as a generic OpenAI-compatible server, never as Anthropic */
export const aiProvider = (id: string): AiProviderInfo =>
  AI_PROVIDERS.find((p) => p.id === id) ?? { ...AI_PROVIDERS.find((p) => p.id === 'custom')!, id: id as AiProvider, label: id }

/** What the UI sees: never the keys themselves */
export interface AiConfigView {
  provider: AiProvider
  providers: Partial<Record<AiProvider, { model: string; baseUrl?: string; hasKey: boolean }>>
}
export interface AiConfigInput { provider: AiProvider; model: string; baseUrl?: string; /** empty keeps the saved key; null removes it */ key?: string | null }
