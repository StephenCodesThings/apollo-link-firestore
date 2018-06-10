import "jasmine";

import { ApolloLink, execute, makePromise, Observable } from "apollo-link";
import gql from "graphql-tag";

import { createFirestoreLink } from "./firestore-link";

describe("ApolloLinkFirestore", () => {
    let link: ApolloLink;
    let database: any;
    let collection: any;
    let doc: any;

    beforeEach(() => {
        database = jasmine.createSpyObj("db", ["collection"]);
        collection = jasmine.createSpyObj("collection", ["doc"]);
        doc = jasmine.createSpyObj("doc", ["get", "onSnapshot"]);
        database.collection.and.returnValue(collection);
        collection.doc.and.returnValue(doc);
        doc.get.and.returnValue(Promise.resolve(null));
        doc.onSnapshot.and.callFake((callback: any) => callback(null));

        link = createFirestoreLink({
            database,
            partialSchema: gql`
                type Person {
                    id: ID!
                    name: String!
                }
            `,
        });
    });

    it("should return a new link", () => {
        expect(link instanceof ApolloLink).toEqual(true);
    });

    it("should call forward if not a firestore query", async () => {
        const operation = {
            query: gql`query { hello }`,
        };

        const nextSpy = jasmine.createSpy("next").and.returnValue(Observable.from(["done"]));
        const linkWithNext = link.concat(nextSpy);

        await makePromise(execute(linkWithNext, operation));
        expect(nextSpy).toHaveBeenCalled();
    });

    it("should fetch information from firestore", async () => {
        const operation = {
            query: gql`query { person(id: "id") @firestore { name } }`,
        };

        await makePromise(execute(link, operation));
        expect(database.collection).toHaveBeenCalled();
    });
    it ("should subscribe to updates", async () => {
        const operation = {
            query: gql`subscription { personUpdated(id: "id") @firestore { name } }`,
        };
        let expectedValue = 0;

        let firestoreUpdate: any;

        const firestoreObservable = new Observable((observer) => {
            firestoreUpdate = (update: any) => {
                observer.next(update);
            };
          });
        doc.onSnapshot.and.callFake((callback: any) => {
            firestoreObservable.subscribe((update) => callback({ data: () => update}));
        });

        const observable = execute(link, operation);
        observable.subscribe((result) => {
            switch (expectedValue) {
                case 0:
                    expect(result).toEqual({ data: { id: "id", name: "Bob"}});
                    expectedValue++;
                    break;
                case 1:
                    expect(result).toEqual({ data: { id: "id", name: "Bill"}});
                    expectedValue++;
                    break;
                case 2:
                    expect(result).toEqual({ data: { id: "id", name: "Roseanna"}});
                    expectedValue++;
            }
        });
        firestoreUpdate({ name: "Bob"});
        firestoreUpdate({ name: "Bill"});
        firestoreUpdate({ name: "Roseanna"});
    });
});
