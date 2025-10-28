import { describe, expect, it } from "vitest";

import { parseToon } from "./parseToon.js";

describe("parseToon", () => {
  it("parses a simple object", () => {
    const source = `
user:
  id: 1
  name: "Ada Lovelace"
  active: true
`;

    const result = parseToon<{ user: { id: number; name: string; active: boolean } }>(
      source,
    );

    expect(result).toEqual({
      user: {
        id: 1,
        name: "Ada Lovelace",
        active: true,
      },
    });
  });

  it("parses inline arrays and root arrays", () => {
    const source = `
tags[3]: reading,gaming,coding
values[2]:
  - [2]: 1,2
  - [3]: 3,4,5
`;

    const result = parseToon<{
      tags: string[];
      values: number[][];
    }>(source);

    expect(result).toEqual({
      tags: ["reading", "gaming", "coding"],
      values: [
        [1, 2],
        [3, 4, 5],
      ],
    });

    expect(parseToon<string[]>(`[2]: "alpha","beta"`)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("parses tabular arrays", () => {
    const source = `
items[2]{id,name,active}:
  1,Alice,true
  2,Bob,false
`;

    const result = parseToon<{ items: Array<{ id: number; name: string; active: boolean }> }>(
      source,
    );

    expect(result).toEqual({
      items: [
        { id: 1, name: "Alice", active: true },
        { id: 2, name: "Bob", active: false },
      ],
    });
  });

  it("parses list arrays of nested objects", () => {
    const source = `
users[2]:
  - id: 1
    name: Alice
    roles[2]: admin,owner
  - id: 2
    name: Bob
    profile:
      email: bob@example.com
`;

    const result = parseToon<{ users: Array<Record<string, unknown>> }>(source);

    expect(result).toEqual({
      users: [
        {
          id: 1,
          name: "Alice",
          roles: ["admin", "owner"],
        },
        {
          id: 2,
          name: "Bob",
          profile: {
            email: "bob@example.com",
          },
        },
      ],
    });
  });

  it("throws on malformed content", () => {
    const malformed = `
key:
   value: 1
`;

    expect(() => parseToon(malformed)).toThrow();
  });
});
