import { firestore } from "firebase";
import {
  DocumentNode,
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLType,
  isLeafType,
  ObjectTypeDefinitionNode,
  TypeNode,
} from "graphql";
import { PubSub } from "graphql-subscriptions";

interface Context {
  database: firestore.Firestore;
}

interface TypeMapping {
  [key: string]: GraphQLType;
}

interface ObjectDefinitions {
  [key: string]: ObjectTypeDefinitionNode;
}

export const pubsub = new PubSub();

function toTitleCase(str: string) {
  return str.charAt(0).toUpperCase() + str.substr(1);
}

function getBaseTypename(type: TypeNode): string {
  if (type.kind === "NonNullType" || type.kind === "ListType") {
    return getBaseTypename(type.type);
  } else {
    return type.name.value;
  }
}

function createFieldType(type: TypeNode, typeMapping: TypeMapping): GraphQLType {
  if (type.kind === "NonNullType") {
    return new GraphQLNonNull(createFieldType(type.type, typeMapping));
  } else if (type.kind === "ListType") {
    return new GraphQLList(createFieldType(type.type, typeMapping));
  } else {
    return typeMapping[type.name.value];
  }
}

function createObjectType(definition: ObjectTypeDefinitionNode, typeMapping: TypeMapping): GraphQLType {
  const typename = definition.name.value;

  if (!typeMapping[typename]) {
    typeMapping[typename] = new GraphQLObjectType({
      name: typename,
      fields: () => {
        const fields: any = {};
        for (const field of definition.fields) {
          fields[field.name.value] = { type: createFieldType(field.type, typeMapping) };
        }
        return fields;
      },
    });
  }
  return typeMapping[typename];
}

function createInputFieldType(
  type: TypeNode,
  typeMapping: TypeMapping,
  objectDefinitions: ObjectDefinitions,
): GraphQLType {
  if (type.kind === "NonNullType") {
    return new GraphQLNonNull(createFieldType(type.type, typeMapping));
  } else if (type.kind === "ListType") {
    return new GraphQLList(createFieldType(type.type, typeMapping));
  } else {
    const baseType = typeMapping[type.name.value];
    if (isLeafType(baseType)) {
      return baseType;
    }
    return createCreateInputObjectType(objectDefinitions[type.name.value], typeMapping, objectDefinitions);
  }
}

function createCreateInputObjectType(
  definition: ObjectTypeDefinitionNode,
  typeMapping: TypeMapping,
  objectDefinitions: ObjectDefinitions,
): GraphQLInputObjectType {
  const typename = definition.name.value;

  const fields: any = {};
  for (const field of definition.fields) {
    const baseType = typeMapping[getBaseTypename(field.type)];
    if (isLeafType(baseType) && baseType !== GraphQLID) {
      fields[field.name.value] = { type: createInputFieldType(field.type, typeMapping, objectDefinitions) };
    }
  }
  const inputType = new GraphQLInputObjectType({
    name: `Create${typename}Input`,
    fields,
  });

  return inputType;
}

function createCreateMutation(
  definition: ObjectTypeDefinitionNode,
  typeMapping: TypeMapping,
  objectDefinitions: ObjectDefinitions,
) {
  const typename = definition.name.value;

  const inputType = createCreateInputObjectType(definition, typeMapping, objectDefinitions);

  return {
    type: typeMapping[typename],
    args: {
      input: { type: inputType },
    },
    async resolve(_: any, { input }: any, context: Context) {
      const result = await context.database.collection(typename).add(input);
      return {
        id: result.id,
        ...input,
      };
    },
  };
}

function createAddAndRemoveMutations(definition: ObjectTypeDefinitionNode, typeMapping: TypeMapping) {
  const typename = definition.name.value;
  const mutations = new Map();

  for (const field of definition.fields) {
    const fieldTypename = getBaseTypename(field.type);

    if (!isLeafType(typeMapping[fieldTypename])) {
      const primaryId = `${typename.toLowerCase()}Id`;
      const secondaryId = `${typename.toLowerCase()}Id`;
      mutations.set(`add${toTitleCase(field.name.value)}To${typename}`, {
        type: typeMapping[typename],
        args: {
          [primaryId]: { type: GraphQLID },
          [secondaryId]: { type: GraphQLID },
        },
        async resolve(_: any, args: any, context: Context) {
          await context.database.collection(fieldTypename).doc(args[secondaryId]).update({
            [`__relations.${typename}.${field.name.value}`]: args[primaryId],
          });
          return args[primaryId];
        },
      });
    }
  }

  return mutations;
}

export function createFullSchema(partialSchema: DocumentNode): GraphQLSchema {

  const objectDefinitions: ObjectDefinitions = Object.assign(
    {},
    ...partialSchema.definitions
      .filter((definition) => definition.kind === "ObjectTypeDefinition")
      .map((definition) => ({
        [(definition as ObjectTypeDefinitionNode).name.value]: definition,
      })),
  );

  const typeMapping: TypeMapping = {
    String: GraphQLString,
    Int: GraphQLInt,
    ID: GraphQLID,
    Boolean: GraphQLBoolean,
    Float: GraphQLFloat,
  };

  for (const definition of partialSchema.definitions) {
    if (definition.kind === "ObjectTypeDefinition") {
      createObjectType(definition, typeMapping);
    }
  }

  const queryType = new GraphQLObjectType({
    name: "Query",
    fields: () => {
      const fields: any = {};
      for (const definition of partialSchema.definitions) {
        if (definition.kind === "ObjectTypeDefinition") {
          const typename = definition.name.value;

          fields[typename.toLowerCase()] = {
            type: typeMapping[typename],
            args: {
              id: { type: GraphQLID },
            },
            async resolve(_: any, {id}: any, context: Context) {
              const result = await context.database.collection(typename).doc(id).get();
              if (result.exists) {
                return {
                  id,
                  ...result.data(),
                };
              } else {
                  return null;
              }
            },
          };
        }
      }
      return fields;
    },
  });

  const mutationType = new GraphQLObjectType({
    name: "Mutation",
    fields: () => {
      const fields: any = {};
      for (const definition of partialSchema.definitions) {
        if (definition.kind === "ObjectTypeDefinition") {
          const typename = definition.name.value;
          fields[`create${typename}`] = createCreateMutation(definition, typeMapping, objectDefinitions);
          for (const [fieldKey, field] of createAddAndRemoveMutations(definition, typeMapping)) {
            fields[fieldKey] = field;
          }
        }
      }
      return fields;
    },
  });

  const subscriptionType = new GraphQLObjectType({
    name: "Subscription",
    fields: () => {
      const fields: any = {};
      for (const definition of partialSchema.definitions) {
        if (definition.kind === "ObjectTypeDefinition") {
          const typename = definition.name.value;
          fields[`${typename.toLowerCase()}Updated`] = {
            type: typeMapping[typename],
            args: {
              id: { type: GraphQLID },
            },
            subscribe: (_: any, { id }: any, context: any) => {
              const topic = `${typename.toLowerCase()}Updated:${id}`;
              const iterator = pubsub.asyncIterator(topic);

              context.database.collection(typename).doc(id)
                .onSnapshot((doc: any) => {
                  pubsub.publish(topic, {
                    id,
                    ...doc.data(),
                  });
                });

              return iterator;
            },
          };
        }
      }
      return fields;
    },
  });

  return new GraphQLSchema({
    query: queryType,
    mutation: mutationType,
    subscription: subscriptionType,
  });
}
