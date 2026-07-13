import { describe, it, expect } from "vitest"
import { getEverydayFlows } from "../../src/flows/everyday-registry"
import { neonDatabaseSnapshotFlow } from "../../src/flows/neon-database-snapshot.flow"

describe("everyday flow registry", () => {
  it("registers the neon-database-snapshot flow", () => {
    const flows = getEverydayFlows()
    expect(flows).toContain(neonDatabaseSnapshotFlow)
  })
})
