import Foundation
import Synchronization
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
    let store = AppStore(api: TestAPI(ranking: { id throws(APIError) in
      // Repo 1's ranking answers only once its task is cancelled.
      if id == 1 { try? await Task.sleep(for: .seconds(3600)) }
      return try await FixtureAPI(scenario: .ranking).ranking(repoID: id)
    }))
    // Runs until the load for repo 1 is waiting on the API.
    let first = Task.immediate { await store.select(1) }

    await store.select(2)
    first.cancel()
    await first.value

    #expect(store.selectedRepoID == 2)
    #expect(store.ranking.value?.repo.id == 2)
  }

  @Test func aRankingFailureIsSurfaced() async {
    let store = AppStore(api: TestAPI(ranking: { _ throws(APIError) in
      throw .server(status: 500, code: "internal", message: "connect ECONNREFUSED ::1:5432")
    }))
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

  @Test func unreachableIsSurfaced() async {
    let store = AppStore(api: FixtureAPI(scenario: .unreachable))
    await store.refresh()

    guard case .failed(.unreachable) = store.repos else {
      Issue.record("Expected .failed(.unreachable), got \(String(describing: store.repos))")
      return
    }
    #expect(!store.isRefreshing)
  }

  @Test func aServerErrorIsSurfacedWithItsMessage() async throws {
    let body = try JSONDecoder.ciRadar().decode(ErrorBody.self, from: Fixtures.data(named: "error-internal.json"))
    let store = AppStore(api: TestAPI(repos: { () throws(APIError) in
      throw .server(status: 500, code: body.error.code, message: body.error.message)
    }))
    await store.refresh()

    guard case .failed(.server(500, "internal", "No user found. Run `pnpm seed` first.")) = store.repos else {
      Issue.record("Expected the 500, got \(String(describing: store.repos))")
      return
    }
  }

  @Test func refreshKeepsTheCurrentDataOnScreenUntilTheNewDataArrives() async throws {
    let gate = Gate()
    let calls = Mutex(0)
    let store = AppStore(api: TestAPI(repos: { () throws(APIError) in
      // The second load (the refresh) waits for the test to open the gate.
      if calls.withLock { count in count += 1; return count } == 2 { await gate.wait() }
      return try await FixtureAPI(scenario: .ranking).repos()
    }))
    await store.refresh()
    #expect(!store.isRefreshing)

    // Runs until the refresh is waiting on the API.
    let refresh = Task.immediate { await store.refresh() }

    #expect(store.isRefreshing)
    #expect(store.repos.value == fixtureRepos)
    #expect(store.ranking.value?.repo.id == 1)

    gate.open()
    await refresh.value
    #expect(!store.isRefreshing)
    #expect(store.repos.value == fixtureRepos)
    #expect(store.ranking.value?.repo.id == 1)
  }

  @Test func aRefreshWhileOneIsRunningDoesNothing() async {
    let gate = Gate()
    let calls = Mutex(0)
    let store = AppStore(api: TestAPI(repos: { () throws(APIError) in
      calls.withLock { count in count += 1 }
      await gate.wait()
      return try await FixtureAPI(scenario: .ranking).repos()
    }))
    let first = Task.immediate { await store.refresh() }

    await store.refresh()
    gate.open()
    await first.value

    #expect(calls.withLock { $0 } == 1)
    #expect(store.repos.value == fixtureRepos)
  }

  @Test func aRepoThatVanishedRefreshesTheListInsteadOfFailing() async {
    let calls = Mutex(0)
    let store = AppStore(api: TestAPI(
      repos: { () throws(APIError) in
        let all = try await FixtureAPI(scenario: .ranking).repos()
        // Repo 1 stops being watched after the first load.
        return calls.withLock { count in count += 1; return count } == 1 ? all : all.filter { $0.id != 1 }
      },
      ranking: { id throws(APIError) in
        if id == 1 { throw .server(status: 404, code: "repo_not_found", message: "Repo 1 is not watched.") }
        return try await FixtureAPI(scenario: .ranking).ranking(repoID: id)
      }))

    await store.refresh()

    #expect(store.repos.value?.map(\.id) == [3, 2, 4])
    #expect(store.selectedRepoID == 3)
    #expect(store.ranking.value?.repo.id == 3)
  }

  @Test func selectingARepoThatVanishedRefreshesTheList() async {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    await store.refresh()

    // Repo 99 isn't in the fixtures, so the API answers 404 repo_not_found.
    await store.select(99)

    #expect(store.repos.value == fixtureRepos)
    #expect(store.selectedRepoID == 1)
    #expect(store.ranking.value?.repo.id == 1)
  }

  @Test func aRepoTheListStillNamesButTheRankingCannotFindIsAnError() async {
    let store = AppStore(api: TestAPI(ranking: { id throws(APIError) in
      throw .server(status: 404, code: "repo_not_found", message: "Repo \(id) is not watched.")
    }))

    await store.refresh()

    guard case .failed(.server(404, "repo_not_found", "Repo 1 is not watched.")) = store.ranking else {
      Issue.record("Expected the 404, got \(String(describing: store.ranking))")
      return
    }
  }

  @Test(arguments: [
    (FixtureAPI.Scenario.nothingFlaky, "icomey8/quiet-lib"),
    (FixtureAPI.Scenario.notIngested, "octo-org/new-service"),
  ])
  func aRankingStateScenarioSelectsARepoInThatStateAtLaunch(_ scenario: FixtureAPI.Scenario, _ fullName: String)
    async throws
  {
    let store = AppStore(api: FixtureAPI(scenario: scenario))
    await store.refresh()

    #expect(Set(try #require(store.repos.value)) == Set(fixtureRepos))
    let ranking = try #require(store.ranking.value)
    #expect(ranking.repo.fullName == fullName)
    #expect(ranking.flaky.isEmpty && ranking.broken.isEmpty)
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

/// The `ranking` scenario, with either answer replaced by a closure.
private struct TestAPI: CIRadarAPI {
  let answerRepos: @Sendable () async throws(APIError) -> [Repo]
  let answerRanking: @Sendable (Repo.ID) async throws(APIError) -> Ranking

  init(
    repos: @escaping @Sendable () async throws(APIError) -> [Repo] = {
      () async throws(APIError) in try await FixtureAPI(scenario: .ranking).repos()
    },
    ranking: @escaping @Sendable (Repo.ID) async throws(APIError) -> Ranking = {
      id async throws(APIError) in try await FixtureAPI(scenario: .ranking).ranking(repoID: id)
    }
  ) {
    answerRepos = repos
    answerRanking = ranking
  }

  func repos() async throws(APIError) -> [Repo] {
    try await answerRepos()
  }

  func ranking(repoID: Repo.ID) async throws(APIError) -> Ranking {
    try await answerRanking(repoID)
  }
}

/// Holds back whoever waits on it until the test opens it.
private final class Gate: Sendable {
  private let stream: AsyncStream<Void>
  private let continuation: AsyncStream<Void>.Continuation

  init() {
    (stream, continuation) = AsyncStream.makeStream()
  }

  func wait() async {
    for await _ in stream {}
  }

  func open() {
    continuation.finish()
  }
}
