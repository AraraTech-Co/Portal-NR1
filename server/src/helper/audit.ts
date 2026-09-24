import prisma from "../model/prisma";

export async function writeAudit(input: {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  context?: unknown;
}) {
  await prisma.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: (input.before as never) ?? undefined,
      after: (input.after as never) ?? undefined,
      context: (input.context as never) ?? undefined,
    },
  });
}
