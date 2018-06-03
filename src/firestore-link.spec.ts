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
        collection = jasmine.createSpyObj("collection", ["doc", "add"]);
        doc = jasmine.createSpyObj("doc", ["get"]);
        database.collection.and.returnValue(collection);
        collection.doc.and.returnValue(doc);
        collection.add.and.returnValue(Promise.resolve(null));
        doc.get.and.returnValue(Promise.resolve(null));

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
        doc.get.and.returnValue(Promise.resolve({ exists: true, data: () => ({ name: "Bob" })}));

        const result = await makePromise(execute(link, operation));
        expect(doc.get).toHaveBeenCalled();
        expect(result).toEqual({ data: { person: { name: "Bob" } } });
    });

    it("should mutate information in firestore", async () => {
        const operation = {
            query: gql`mutation CreatePerson { createPerson(input: { name: "Bob" }) @firestore { name } }`,
        };

        collection.add.and.returnValue(Promise.resolve({ id: "foo" }));

        const result = await makePromise(execute(link, operation));
        expect(collection.add).toHaveBeenCalled();
        expect(result).toEqual({ data: { createPerson: { name: "Bob" } } });
    });
});
