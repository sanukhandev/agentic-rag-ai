import { z } from 'zod';

export const roleSchema = z.enum(['platform_admin', 'tenant_admin', 'tenant_editor', 'tenant_viewer', 'tenant_agent']);
export type Role = z.infer<typeof roleSchema>;

export const authContextSchema = z.object({
  userId: z.string().guid(),
  email: z.string().email(),
  role: roleSchema,
  tenantId: z.string().guid().nullable(),
});
export type AuthContext = z.infer<typeof authContextSchema>;

export const citationSchema = z.object({
  sourceId: z.string().guid(),
  versionId: z.string().guid(),
  chunkId: z.string().guid(),
  title: z.string().min(1),
  locator: z.string().min(1),
});
export type Citation = z.infer<typeof citationSchema>;

export const chatMessageRequestSchema = z.object({
  sessionId: z.string().guid(),
  message: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().trim().min(1).max(128),
});
export type ChatMessageRequest = z.infer<typeof chatMessageRequestSchema>;

export const actionConfirmationSchema = z.object({
  sessionId: z.string().guid(),
  confirmed: z.literal(true),
});

export const groundedResponseSchema = z.object({
  messageId: z.string().guid(),
  sessionId: z.string().guid(),
  answer: z.string().min(1),
  grounded: z.boolean(),
  citations: z.array(citationSchema),
  actionProposal: z.object({
    id: z.string().guid(),
    intent: z.literal('lead.capture'),
    confirmation: z.string().min(1),
    expiresAt: z.string().datetime(),
  }).nullable(),
  pendingPromptId: z.string().guid().nullable().optional(),
  pendingIntentKey: z.string().min(1).nullable().optional(),
  pendingRequirementKey: z.string().min(1).nullable().optional(),
  requestId: z.string().guid(),
});
export type GroundedResponse = z.infer<typeof groundedResponseSchema>;
