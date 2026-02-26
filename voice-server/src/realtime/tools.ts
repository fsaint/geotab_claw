/**
 * OpenAI Realtime function definitions
 */

export interface RealtimeTool {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const tools: RealtimeTool[] = [
  {
    type: 'function',
    name: 'get_vehicle_status',
    description:
      'Get real-time status of a fleet vehicle including location, speed, whether it is moving or stopped, and how long it has been in its current state. Use this when someone asks about a specific truck or vehicle.',
    parameters: {
      type: 'object',
      properties: {
        vehicle: {
          type: 'string',
          description: "Vehicle name like 'Demo-03', 'truck 3', or driver name like 'Mike'",
        },
      },
      required: ['vehicle'],
    },
  },
  {
    type: 'function',
    name: 'get_fleet_overview',
    description:
      'Get status of all vehicles in the fleet - how many are driving, stopped, or offline. Use this when someone asks about the overall fleet status or wants to check on everyone.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'initiate_call',
    description:
      "Call a driver or the boss. Use this when you decide you need to make a phone call to someone - for example, to check on a driver who has been stopped too long, or to call the boss back with an update.",
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: "Who to call - driver name like 'Mike' or 'Mike Reyes', or 'boss'",
        },
        reason: {
          type: 'string',
          description: 'Brief reason for the call, like "check why stopped" or "update on Mike"',
        },
        context: {
          type: 'string',
          description: 'Key info to carry forward to the next call - what you learned or need to communicate',
        },
      },
      required: ['target', 'reason'],
    },
  },
  {
    type: 'function',
    name: 'end_current_call',
    description:
      'End the current phone call. Use this when the conversation is naturally complete and you have said goodbye.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of what happened in this call',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'save_context',
    description:
      'Save important information from the conversation for cross-call memory. Use this to remember what the boss asked about, what deadlines were mentioned, or what a driver said.',
    parameters: {
      type: 'object',
      properties: {
        boss_asked_about: {
          type: 'string',
          description: 'What the boss is asking about',
        },
        vehicle: {
          type: 'string',
          description: 'Which vehicle is being discussed',
        },
        deadline: {
          type: 'string',
          description: 'Any deadline mentioned',
        },
        driver_said: {
          type: 'string',
          description: "What the driver said (their excuse or explanation)",
        },
        driver_commitment: {
          type: 'string',
          description: 'What the driver committed to doing',
        },
        diplomatic_response: {
          type: 'string',
          description: 'The diplomatic version to tell the boss',
        },
      },
    },
  },
];

export function getToolsConfig(): RealtimeTool[] {
  return tools;
}
