import { v4 as uuidv4 } from "uuid";

type PrismaDelegate = {
  create: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  createMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  findMany: (args?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  findFirst: (
    args?: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
  update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  delete: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  count: (args?: Record<string, unknown>) => Promise<number>;
};

/**
 * Mapeia campos snake_case da API para camelCase do Prisma.
 * Ampliar conforme novos modelos de domínio forem adicionados.
 */
function mapToPrismaFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = { ...data };

  const fieldMap: Record<string, string> = {
    account_id: "accountId",
    user_id: "userId",
    organization_id: "organizationId",
    date_created: "dateCreated",
  };

  for (const [from, to] of Object.entries(fieldMap)) {
    if (from in mapped) {
      mapped[to] = mapped[from];
      delete mapped[from];
    }
  }

  return mapped;
}

/**
 * Classe base OOP para acesso a dados via Prisma.
 * Subclasses tipam a entidade e passam o delegate no constructor.
 *
 * Uso futuro:
 *   export class Risk extends Model<IRisk> {
 *     constructor() { super(prisma.risk as never); }
 *   }
 */
export default abstract class Model<T = Record<string, unknown>> {
  protected delegate: PrismaDelegate;

  constructor(delegate: PrismaDelegate) {
    this.delegate = delegate;
  }

  public create: {
    new: (document: Partial<T>, id?: string) => Promise<T>;
    batch: (
      documents: Array<Partial<T>>,
      ordered?: boolean,
      accountId?: string | null,
    ) => Promise<Array<T>>;
  } = {
    new: async (document, id = uuidv4()) => {
      const result = await this.delegate.create({
        data: mapToPrismaFields({ id, ...document }),
      });
      return result as T;
    },

    batch: async (documents, _ordered = false, accountId = null) => {
      const documentsWithId = documents.map((document) =>
        mapToPrismaFields({
          ...(accountId ? { accountId } : {}),
          id: uuidv4(),
          ...document,
        }),
      );

      await this.delegate.createMany({ data: documentsWithId });
      return documentsWithId as Array<T>;
    },
  };

  public read: {
    all: (
      query?: Record<string, unknown>,
      projection?: Record<string, unknown>,
      sort?: Record<string, "asc" | "desc">,
    ) => Promise<Array<T>>;
    one: (
      query: Record<string, unknown>,
      projection?: Record<string, unknown>,
    ) => Promise<T | null>;
    paginate: (
      query: Record<string, unknown>,
      limit: number,
      page: number,
    ) => Promise<{ results: T[]; total: number }>;
    search: (
      options: { filter: string; fields: string[] },
      accountId: string,
      limit?: number,
    ) => Promise<Array<T>>;
  } = {
    all: async (query = {}, _projection = {}, sort = {}) => {
      const orderBy = Object.entries(sort).map(([key, direction]) => ({
        [key]: direction,
      }));

      const results = await this.delegate.findMany({
        where: mapToPrismaFields(query),
        ...(orderBy.length && { orderBy }),
      });

      return results as T[];
    },

    one: async (query, _projection = {}) => {
      const result = await this.delegate.findFirst({
        where: mapToPrismaFields(query),
      });
      return (result as T) || null;
    },

    paginate: async (query, limit, page) => {
      const skip = (page - 1) * limit;
      const mappedQuery = mapToPrismaFields(query);
      const [results, total] = await Promise.all([
        this.delegate.findMany({ where: mappedQuery, skip, take: limit }),
        this.delegate.count({ where: mappedQuery }),
      ]);

      return { results: results as T[], total };
    },

    search: async (
      options: { filter: string; fields: string[] },
      accountId: string,
      limit = 10,
    ) => {
      const { filter, fields } = options;

      if (!filter || filter.trim().length === 0) {
        throw new Error("Search filter must be provided.");
      }

      if (!fields || fields.length === 0) {
        throw new Error("Search fields must be provided.");
      }

      const searchConditions = fields.map((field) => ({
        [field]: { contains: filter, mode: "insensitive" },
      }));

      const results = await this.delegate.findMany({
        where: mapToPrismaFields({
          accountId,
          OR: searchConditions,
        }),
        take: limit,
      });

      return results as T[];
    },
  };

  public update: {
    one: (
      query: Record<string, unknown>,
      update: Record<string, unknown>,
      opts?: { upsert?: boolean },
    ) => Promise<T | null>;
    many: (
      query: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => Promise<{ count: number }>;
  } = {
    one: async (query, update, opts = {}) => {
      const mappedQuery = mapToPrismaFields(query);
      const mappedUpdate = mapToPrismaFields(update);

      if (opts.upsert) {
        const result = await (
          this.delegate as unknown as {
            upsert: (
              args: Record<string, unknown>,
            ) => Promise<Record<string, unknown>>;
          }
        ).upsert({
          where: mappedQuery,
          create: mapToPrismaFields({ id: uuidv4(), ...query, ...update }),
          update: mappedUpdate,
        });
        return result as T;
      }

      const existing = await this.delegate.findFirst({ where: mappedQuery });
      if (!existing) return null;

      const result = await this.delegate.update({
        where: { id: existing.id as string },
        data: mappedUpdate,
      });
      return result as T;
    },

    many: async (query, update) => {
      return await this.delegate.updateMany({
        where: mapToPrismaFields(query),
        data: mapToPrismaFields(update),
      });
    },
  };

  public delete: {
    one: (query: Record<string, unknown>) => Promise<Record<string, unknown>>;
    many: (query: Record<string, unknown>) => Promise<{ count: number }>;
  } = {
    one: async (query) => {
      const existing = await this.delegate.findFirst({
        where: mapToPrismaFields(query),
      });
      if (!existing) return { count: 0 };

      return await this.delegate.delete({
        where: { id: existing.id as string },
      });
    },

    many: async (query) => {
      return await this.delegate.deleteMany({
        where: mapToPrismaFields(query),
      });
    },
  };

  public custom: Record<string, unknown> = {};
}
