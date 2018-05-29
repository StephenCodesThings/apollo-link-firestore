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
        doc = jasmine.createSpyObj("doc", ["get"]);
        database.collection.and.returnValue(collection);
        collection.doc.and.returnValue(doc);
        doc.get.and.returnValue(Promise.resolve(null));
        link = createFirestoreLink({
            database,
            partialSchema: gql`
                type Person {
                    id: ID!
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
});
