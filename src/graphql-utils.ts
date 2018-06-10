import {
  DocumentNode,
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLType,
  ObjectTypeDefinitionNode,
  TypeNode,
} from "graphql";

import { PubSub } from "graphql-subscriptions";

export const pubsub = new PubSub();

export function createFullSchema(partialSchema: DocumentNode): GraphQLSchema {

  const typeMapping: any = {
    String: GraphQLString,
    Int: GraphQLInt,
    ID: GraphQLID,
    Boolean: GraphQLBoolean,
    Float: GraphQLFloat,
  };

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
            resolve(_: any, {id}: any, context: any) {
              return context.database.collection(typename).doc(id).get();
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
          fields[`create${typename}`] = {
            type: typeMapping[typename],
            args: {
              id: { type: GraphQLID },
            },
            resolve(_: any, args: any, context: any) {
              return context.database.collection(typename).doc(args.id).set(args);
            },
          };
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
