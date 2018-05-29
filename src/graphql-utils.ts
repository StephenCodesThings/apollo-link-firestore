import { buildASTSchema, DocumentNode, GraphQLSchema, parse } from "graphql";

export function createFullSchema(partialSchema: DocumentNode): GraphQLSchema {

  const querySchema = `
    type Query {
      ${partialSchema.definitions
        .map((type) =>
          type.kind !== "SchemaDefinition" ? `${type.name!.value.toLowerCase()}(id: ID!): ${type.name!.value}\n` : "")}
    }
  `;

  const fullSchema = parse(querySchema);
  fullSchema.definitions = fullSchema.definitions.concat(partialSchema.definitions);
  return buildASTSchema(fullSchema);
}

export function createResolvers(partialSchema: DocumentNode) {
  const resolvers: {
    [key: string]: (args: any, context: any) => Promise<any>;
  } = {};
  for (const type of partialSchema.definitions) {
    if (type.kind !== "SchemaDefinition") {
      const entityType = type.name!.value;
      resolvers[entityType.toLowerCase()] = (args, context) => {
        return context.database.collection(entityType).doc(args.id).get();
      };
    }
  }

  return resolvers;
}
