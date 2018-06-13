import { ApolloLink, Observable } from "apollo-link";
import {
  getMainDefinition,
  hasDirectives,
} from "apollo-utilities";
import { firestore } from "firebase";
import {
  createSourceEventStream,
  DocumentNode,
  execute,
  OperationTypeNode,
} from "graphql";
import { createFullSchema } from "./graphql-utils";

export interface Options {
  database: firestore.Firestore;
  partialSchema: DocumentNode;
}

export function createFirestoreLink({ database, partialSchema }: Options) {

  const schema = createFullSchema(partialSchema);

  return new ApolloLink((operation, forward) => {

    const isFirestore = hasDirectives(["firestore"], operation.query);

    if (!isFirestore) {
      return forward ? forward(operation) : null;
    }

    const { query, variables, operationName } = operation;
    const context = { database };
    const rootValue = {};
    const mainDefinition = getMainDefinition(query);
    const operationType: OperationTypeNode =
      mainDefinition.kind === "OperationDefinition" ? mainDefinition.operation : "query";
    if (operationType === "subscription") {
      return new Observable((observer) => {
        createSourceEventStream(
          schema,
          query,
          rootValue,
          context,
          variables,
          operationName,
        )
        .then(async (iterator) => {
          for await (const data of iterator) {
            observer.next({ data });
          }
        });
      });
    }
    return new Observable((observer) => {
      const result = execute(
        schema,
        query,
        rootValue,
        context,
        variables,
        operationName,
      );
      result.then((data: any) => {
        observer.next(data);
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
