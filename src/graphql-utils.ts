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
interface Context {
  database: firestore.Firestore;
}

import { PubSub } from "graphql-subscriptions";

export const pubsub = new PubSub();

export function createFullSchema(partialSchema: DocumentNode): GraphQLSchema {

  const typeMapping: { [key: string]: GraphQLType } = {
    String: GraphQLString,
    Int: GraphQLInt,
    ID: GraphQLID,
    Boolean: GraphQLBoolean,
    Float: GraphQLFloat,
  };
  const objectDefinitions: { [key: string]: ObjectTypeDefinitionNode } = {};

  function getBaseType(type: TypeNode): GraphQLType {
    if (type.kind === "NonNullType" || type.kind === "ListType") {
      return getBaseType(type.type);
    } else {
      return typeMapping[type.name.value];
    }
  }

  function createFieldType(type: TypeNode): GraphQLType {
    if (type.kind === "NonNullType") {
      return new GraphQLNonNull(createFieldType(type.type));
    } else if (type.kind === "ListType") {
      return new GraphQLList(createFieldType(type.type));
    } else {
      return typeMapping[type.name.value];
    }
  }

  function createObjectType(definition: ObjectTypeDefinitionNode) {
    const typename = definition.name.value;
    objectDefinitions[typename] = definition;

    if (!typeMapping[typename]) {
      typeMapping[typename] = new GraphQLObjectType({
        name: typename,
        fields: () => {
          const fields: any = {};
          for (const field of definition.fields) {
            fields[field.name.value] = { type: createFieldType(field.type)};
          }
          return fields;
        },
      });
    }
    return typeMapping[typename];
  }

  function createInputFieldType(type: TypeNode): GraphQLType {
    if (type.kind === "NonNullType") {
      return new GraphQLNonNull(createFieldType(type.type));
    } else if (type.kind === "ListType") {
      return new GraphQLList(createFieldType(type.type));
    } else {
      const baseType = typeMapping[type.name.value];
      if (isLeafType(baseType)) {
        return baseType;
      }
      return createInputObjectType(objectDefinitions[type.name.value]);
    }
  }

  function createInputObjectType(definition: ObjectTypeDefinitionNode): GraphQLInputObjectType {
    const typename = definition.name.value;

    const fields: any = {};
    for (const field of definition.fields) {
      const baseType = getBaseType(field.type);
      if (isLeafType(baseType) && baseType !== GraphQLID) {
        fields[field.name.value] = { type: createInputFieldType(field.type) };
      }
    }
    const inputType = new GraphQLInputObjectType({
      name: `Create${typename}Input`,
      fields,
    });

    return inputType;
  }

  function createCreateMutation(definition: ObjectTypeDefinitionNode) {
    const typename = definition.name.value;

    const inputType = createInputObjectType(definition);

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

  for (const definition of partialSchema.definitions) {
    if (definition.kind === "ObjectTypeDefinition") {
      createObjectType(definition);
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
          fields[`create${typename}`] = createCreateMutation(definition);
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
