import Foundation
import Testing

@testable import CIRadarKit

@Suite struct FixtureDecodingTests {
  @Test func decodesReposFixture() throws {
    let response = try JSONDecoder.ciRadar().decode(ReposResponse.self, from: Fixtures.data(named: "repos.json"))

    #expect(response.repos.map(\.fullName) == [
      "icomey8/flaky-test", "icomey8/payments-service", "icomey8/quiet-lib", "octo-org/new-service",
    ])
    let first = try #require(response.repos.first)
    #expect(first.id == 1)
    #expect(first.latestDataAt == Date(timeIntervalSince1970: 1_791_798_067))  // 2026-10-12T09:41:07Z
    #expect(first.flakyCount == 4)
    #expect(first.brokenCount == 1)
    #expect(response.repos.last?.latestDataAt == nil)
  }

  @Test func statusPrefersBrokenOverFlaky() {
    func repo(flaky: Int, broken: Int) -> Repo {
      Repo(id: 1, owner: "o", name: "n", latestDataAt: nil, flakyCount: flaky, brokenCount: broken)
    }
    #expect(repo(flaky: 4, broken: 1).status == .broken)
    #expect(repo(flaky: 0, broken: 2).status == .broken)
    #expect(repo(flaky: 2, broken: 0).status == .flaky)
    #expect(repo(flaky: 0, broken: 0).status == nil)
  }
}
