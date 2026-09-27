import { describe, expect, it } from "vitest";
import { joinArgs, splitArgs } from "./args";

describe("arguments", () => {
  it("découpe en respectant les guillemets", () => {
    expect(splitArgs(`--new-window "Mon Projet" 'a b' c`)).toEqual(["--new-window", "Mon Projet", "a b", "c"]);
    expect(splitArgs(`  `)).toEqual([]);
    expect(splitArgs(`""`)).toEqual([""]);
    expect(splitArgs(`"dit \\"bonjour\\""`)).toEqual(['dit "bonjour"']);
  });

  it("recompose de façon réversible", () => {
    const args = ["--x", "Mon Projet", "", 'a"b'];
    expect(splitArgs(joinArgs(args))).toEqual(args);
  });
});
