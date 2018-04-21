import { ApolloLink } from 'apollo-link';

export function createFirestoreLink() {
  return new ApolloLink((operation, forward) => {
    return forward ? forward(operation) : null;
  });
}