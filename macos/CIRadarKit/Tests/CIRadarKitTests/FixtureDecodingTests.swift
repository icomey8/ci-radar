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

  @Test(arguments: Fixtures.names(withPrefix: "ranking-"))
  func decodesRankingFixture(_ name: String) throws {
    let ranking = try JSONDecoder.ciRadar().decode(Ranking.self, from: Fixtures.data(named: name))
    #expect(ranking.daysBack == 14)
    #expect(ranking.flaky.count == ranking.repo.flakyCount)
    #expect(ranking.broken.count == ranking.repo.brokenCount)
  }

  @Test func decodesRankingRowsInTheirOrder() throws {
    let ranking = try JSONDecoder.ciRadar().decode(Ranking.self, from: Fixtures.data(named: "ranking-ranking.json"))

    #expect(ranking.repo.fullName == "icomey8/flaky-test")
    #expect(ranking.flaky.map(\.failures) == [9, 6, 4, 3])
    #expect(ranking.flaky[0].kind == .test(name: "tests.test_net::test_retry_timeout"))
    #expect(ranking.flaky[1].kind == .job)
    #expect(ranking.broken.map(\.name) == ["publish-docs"])
  }

  @Test(arguments: [
    // A test row must name its test.
    #"{"kind":"test","workflowName":"ci","jobName":"test","testName":null,"failures":1,"runs":10}"#,
    #"{"kind":"step","workflowName":"ci","jobName":"test","testName":null,"failures":1,"runs":10}"#,
  ])
  func aRowOutsideTheContractIsADecodingError(_ row: String) {
    #expect(throws: DecodingError.self) {
      try JSONDecoder.ciRadar().decode(RankedRow.self, from: Data(row.utf8))
    }
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
