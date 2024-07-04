// server/tests/express/framework/NameGenerator.test.js

const NameGenerator = require("../../../express/framework/NameGenerator").default

describe("NameGenerator", () => {
  test('should generate a name in the format "adjective-noun"', () => {
    const name = NameGenerator.getName()
    const parts = name.split("-")

    expect(parts.length).toBe(2) // Expect the name to have two parts separated by a hyphen
    expect(NameGenerator.adj).toContain(parts[0]) // The first part should be a valid adjective
    expect(NameGenerator.nouns).toContain(parts[1]) // The second part should be a valid noun
  })

  test("should generate different names on successive calls", () => {
    const name1 = NameGenerator.getName()
    const name2 = NameGenerator.getName()

    // While this test might occasionally fail due to random chance,
    // in practice, the likelihood of generating the same name twice in a row should be low.
    expect(name1).not.toBe(name2)
  })
})
