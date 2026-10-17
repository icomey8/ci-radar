import Foundation
import Testing

@testable import CIRadarKit

@MainActor @Suite struct AppStoreTests {
  let fixtureRepos: [Repo]

  init() throws {
    fixtureRepos = try JSONDecoder.ciRadar().decode(ReposResponse.self, from: Fixtures.data(named: "repos.json")).repos
  }

  @Test func firstLoadSelectsTheFirstRepoAndLoadsItsRanking() async throws {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    #expect(store.repos.value == nil)

    await store.refresh()

    #expect(store.repos.value == fixtureRepos)
    #expect(store.selectedRepoID == 1)
    let ranking = try #require(store.ranking.value)
    #expect(ranking.repo.id == 1)
    #expect(ranking.flaky.count == 4)
  }

  @Test func selectingADifferentRepoLoadsItsRanking() async {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    await store.refresh()

    await store.select(2)

    #expect(store.selectedRepoID == 2)
    #expect(store.ranking.value?.repo.fullName == "icomey8/quiet-lib")
  }

  @Test func everyRepoInTheRankingScenarioHasARanking() async {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    await store.refresh()

    for repo in fixtureRepos {
      await store.select(repo.id)
      #expect(store.ranking.value?.repo == repo)
    }
  }

  @Test func aSupersededLoadDoesNotReplaceTheNewerRanking() async {
    let store = AppStore(api: TestAPI { id throws(APIError) in
      // Repo 1's ranking answers only once its task is cancelled.
      if id == 1 { try? await Task.sleep(for: .seconds(3600)) }
      return try await FixtureAPI(scenario: .ranking).ranking(repoID: id)
    })
    // Runs until the load for repo 1 is waiting on the API.
    let first = Task.immediate { await store.select(1) }

    await store.select(2)
    first.cancel()
    await first.value

    #expect(store.selectedRepoID == 2)
    #expect(store.ranking.value?.repo.id == 2)
  }

  @Test func aRankingFailureIsSurfaced() async {
    let store = AppStore(api: TestAPI { _ throws(APIError) in
      throw .server(status: 500, code: "internal", message: "connect ECONNREFUSED ::1:5432")
    })
    await store.refresh()

    guard case .failed(.server(500, "internal", "connect ECONNREFUSED ::1:5432")) = store.ranking else {
      Issue.record("Expected the 500, got \(String(describing: store.ranking))")
      return
    }
  }

  @Test func refreshKeepsASelectionThatStillExists() async {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    await store.refresh()
    await store.select(2)

    await store.refresh()

    #expect(store.selectedRepoID == 2)
    #expect(store.ranking.value?.repo.id == 2)
  }

  @Test func refreshReselectsWhenTheSelectedRepoIsGone() async {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    await store.refresh()
    await store.select(99)

    await store.refresh()

    #expect(store.selectedRepoID == 1)
    #expect(store.ranking.value?.repo.id == 1)
  }

  @Test func noReposMeansNoSelection() async {
    let store = AppStore(api: FixtureAPI(scenario: .noRepos))
    await store.refresh()

    #expect(store.repos.value == [])
    #expect(store.selectedRepoID == nil)
    guard case .idle = store.ranking else {
      Issue.record("Expected no ranking, got \(String(describing: store.ranking))")
      return
    }
  }

  @Test func failureIsSurfaced() async {
    let store = AppStore(api: FixtureAPI(scenario: .unreachable))
    await store.refresh()

    guard case .failed(.unreachable) = store.repos else {
      Issue.record("Expected .failed(.unreachable), got \(String(describing: store.repos))")
      return
    }
  }

  @Test func loadingScenarioStaysLoading() async throws {
    let store = AppStore(api: FixtureAPI(scenario: .loading))
    let refresh = Task { await store.refresh() }
    defer { refresh.cancel() }

    try await Task.sleep(for: .milliseconds(100))

    guard case .loading = store.repos else {
      Issue.record("Expected .loading, got \(String(describing: store.repos))")
      return
    }
  }
}

/// The fixture repos, with rankings from a closure.
private struct TestAPI: CIRadarAPI {
  let answerRanking: @Sendable (Repo.ID) async throws(APIError) -> Ranking

  init(ranking: @escaping @Sendable (Repo.ID) async throws(APIError) -> Ranking) {
    answerRanking = ranking
  }

  func repos() async throws(APIError) -> [Repo] {
    try await FixtureAPI(scenario: .ranking).repos()
  }

  func ranking(repoID: Repo.ID) async throws(APIError) -> Ranking {
    try await answerRanking(repoID)
  }
}
