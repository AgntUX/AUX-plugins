/**
 * Reference: Server-Side Tool Handler Patterns
 *
 * Copy destination: server/tools/{tool-name}.ts
 * Import paths below are relative to that destination, not this file's location.
 *
 * Copy and adapt the patterns you need into server/tools/{tool-name}.ts.
 * Export each handler from server/index.ts with the tool name.
 */

import type { ToolHandler } from '../types.js';

// =============================================================================
// RELAY PATTERN HANDLER — Transform host-fetched data for the component
// =============================================================================

/**
 * Receives relay data from the host (fetched from third-party connectors)
 * and transforms it into the component's output format.
 *
 * - Top-level fields → structuredContent (model sees this)
 * - _meta object → widget-only data (component renders from this)
 */
export const relayHandler: ToolHandler = async (input, _context) => {
  // Validate required relay fields
  const company = input.company as Record<string, unknown> | undefined;
  if (!company) {
    return {
      error:
        'Missing company data. Read the skill, fetch company data from HubSpot, and retry.',
    };
  }

  // Return structured output
  return {
    // Top-level: model sees these (keep concise)
    companyName: company.name,
    status: 'success',
    // _meta: component renders from this (can be rich/nested)
    _meta: {
      company: input.company,
      deals: input.deals,
      contacts: input.contacts,
    },
  };
};

// =============================================================================
// API HANDLER — Call an external API using secrets
// =============================================================================

export const apiHandler: ToolHandler = async (input, context) => {
  const apiKey = context.secrets.MY_API_KEY;
  if (!apiKey) {
    throw new Error('MY_API_KEY secret is not configured');
  }

  const query = input.query as string;
  const response = await fetch(
    `https://api.example.com/data?q=${encodeURIComponent(query)}&key=${apiKey}`,
  );

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as Record<string, unknown>;
};

// =============================================================================
// MOCK HANDLER — Dynamic data for testing (third_party_mock servers)
// =============================================================================

/**
 * Mock handlers should satisfy two goals:
 * 1. Golden prompts are effective: canonical entities are STATIC (hardcoded)
 * 2. Tests are repeatable: IDs, timestamps, metrics are DYNAMIC (randomized)
 */
export const mockListHandler: ToolHandler = async (_input, _context) => {
  const randomId = () => Math.random().toString(36).substring(2, 10);
  const randomCount = () => Math.floor(Math.random() * 50) + 1;

  return {
    items: [
      // Canonical entity — always present, static values for golden prompts
      {
        id: 'canonical-001',
        name: 'Acme Corp',
        status: 'active',
        count: randomCount(),
      },
      // Random entities — dynamic for test repeatability
      ...Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => ({
        id: randomId(),
        name: `Company ${randomId()}`,
        status: Math.random() > 0.5 ? 'active' : 'inactive',
        count: randomCount(),
      })),
    ],
  };
};
