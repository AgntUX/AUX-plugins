export interface ToolContext {
  secrets: Record<string, string>; // API keys from app_secrets table
  appId: string;
  componentId: string;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext,
) => Promise<Record<string, unknown>>;
