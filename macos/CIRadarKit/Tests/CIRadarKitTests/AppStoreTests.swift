import Foundation
import Testing

@testable import CIRadarKit

@MainActor @Suite struct AppStoreTests {
  let fixtureRepos = try! JSONDecoder.ciRadar().decode(ReposResponse.self, from: Fixtures.data(named: "repos.json")).repos

  @Test func firstLoadSelectsTheFirstRepo() async {
    let store = AppStore(api: StubAPI { fixtureRepos })
    #expect(store.repos.value == nil)

    await store.refresh()

    #expect(store.repos.value == fixtureRepos)
    #expect(store.selectedRepoID == 1)
  }

  @Test func refreshKeepsASelectionThatStillExists() async {
    let store = AppStore(api: StubAPI { fixtureRepos })
    await store.refresh()
    store.selectedRepoID = 2

    await store.refresh()

    #expect(store.selectedRepoID == 2)
  }

  @Test func refreshReselectsWhenTheSelectedRepoIsGone() async {
    let store = AppStore(api: StubAPI { fixtureRepos })
    await store.refresh()
    store.selectedRepoID = 99

    await store.refresh()

    #expect(store.selectedRepoID == 1)
  }

  @Test func noReposMeansNoSelection() async {
    let store = AppStore(api: StubAPI { [] })
    await store.refresh()

    #expect(store.repos.value == [])
    #expect(store.selectedRepoID == nil)
  }

  @Test func failureIsSurfaced() async {
    let store = AppStore(api: StubAPI { () throws(APIError) in
      throw .unreachable(underlying: URLError(.cannotConnectToHost))
    })
    await store.refresh()

    guard case .failed(.unreachable) = store.repos else {
      Issue.record("Expected .failed(.unreachable), got \(String(describing: store.repos))")
      return
    }
  }
}

struct StubAPI: CIRadarAPI {
  let onRepos: @Sendable () async throws(APIError) -> [Repo]

  init(repos: @escaping @Sendable () async throws(APIError) -> [Repo]) {
    onRepos = repos
  }

  func repos() async throws(APIError) -> [Repo] {
    try await onRepos()
  }
}
