import Foundation
import Testing

@testable import CIRadarKit

@MainActor @Suite struct AppStoreTests {
  let fixtureRepos: [Repo]

  init() throws {
    fixtureRepos = try JSONDecoder.ciRadar().decode(ReposResponse.self, from: Fixtures.data(named: "repos.json")).repos
  }

  @Test func firstLoadSelectsTheFirstRepo() async {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    #expect(store.repos.value == nil)

    await store.refresh()

    #expect(store.repos.value == fixtureRepos)
    #expect(store.selectedRepoID == 1)
  }

  @Test func refreshKeepsASelectionThatStillExists() async {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    await store.refresh()
    store.selectedRepoID = 2

    await store.refresh()

    #expect(store.selectedRepoID == 2)
  }

  @Test func refreshReselectsWhenTheSelectedRepoIsGone() async {
    let store = AppStore(api: FixtureAPI(scenario: .ranking))
    await store.refresh()
    store.selectedRepoID = 99

    await store.refresh()

    #expect(store.selectedRepoID == 1)
  }

  @Test func noReposMeansNoSelection() async {
    let store = AppStore(api: FixtureAPI(scenario: .noRepos))
    await store.refresh()

    #expect(store.repos.value == [])
    #expect(store.selectedRepoID == nil)
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
