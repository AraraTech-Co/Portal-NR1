import { NotificationKind } from "@prisma/client";
import prisma from "../model/prisma";

/**
 * Avisa uma pessoa dentro do portal. Nunca derruba a operação que o gerou:
 * o aviso é consequência, não a ação principal. [S3-A] [S3-G]
 *
 * A chave (pessoa + entidade + tipo) impede o mesmo aviso duas vezes — se o
 * fato se repetir, o aviso volta a ficar não lido.
 */
export async function notify(input: {
  organizationId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<void> {
  try {
    const where = {
      userId_entityType_entityId_kind: {
        userId: input.userId,
        entityType: input.entityType ?? "",
        entityId: input.entityId ?? "",
        kind: input.kind,
      },
    };
    await prisma.notification.upsert({
      where,
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        entityType: input.entityType ?? "",
        entityId: input.entityId ?? "",
      },
      update: {
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        readAt: null,
        createdAt: new Date(),
      },
    });
  } catch {
    /* um aviso que falha não pode desfazer o que já foi feito */
  }
}

/** Avisa várias pessoas de uma vez, sem repetir quem já está na lista. */
export async function notifyMany(
  userIds: readonly string[],
  input: Omit<Parameters<typeof notify>[0], "userId">,
): Promise<void> {
  for (const userId of [...new Set(userIds)]) {
    await notify({ ...input, userId });
  }
}
