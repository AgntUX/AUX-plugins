import type { ToolHandler } from '../types.js';

/**
 * Example tool handler.
 * Rename this file to match your tool name (e.g., weather-get-current.ts).
 * The handler receives tool input and a context with secrets/config.
 */
export const handler: ToolHandler = async (_input, _context) => {
  // Example: fetch from an external API
  // const apiKey = context.secrets.MY_API_KEY;
  // const response = await fetch(`https://api.example.com/data?key=${apiKey}`);
  // const data = await response.json();
  // return data;

  return { message: 'Replace this with your tool implementation' };
};
