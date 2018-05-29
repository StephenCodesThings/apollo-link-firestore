import { ApolloLink, Observable } from "apollo-link";
import {
  hasDirectives,
} from "apollo-utilities";
import { firestore } from "firebase";
import { DocumentNode, execute } from "graphql";
import { createFullSchema, createResolvers } from "./graphql-utils";

export interface Options {
  database: firestore.Firestore;
  partialSchema: DocumentNode;
}

export function createFirestoreLink({ database, partialSchema }: Options) {

  const schema = createFullSchema(partialSchema);
  const rootResolver = createResolvers(partialSchema);

  return new ApolloLink((operation, forward) => {

    const isFirestore = hasDirectives(["firestore"], operation.query);

    if (!isFirestore) {
      return forward ? forward(operation) : null;
    }

    const { query, variables, operationName } = operation;
    const context = { database };

    return new Observable((observer) => {
      const result = execute(
        schema,
        query,
        rootResolver,
        context,
        variables,
        operationName,
      );

      result.then((data: any) => {
        observer.next({ data });
        observer.complete();
      })
      .catch((err: any) => {
        if (err.name === "AbortError") { return; }
        if (err.result && err.result.errors) {
          observer.next(err.result);
        }
        observer.error(err);
      });
    });
  });
}
