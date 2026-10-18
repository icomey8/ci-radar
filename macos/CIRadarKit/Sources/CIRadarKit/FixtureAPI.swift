import Foundation

#if DEBUG

/// Serves a named scenario from the bundled contract fixtures, with no backend (spec §5.3).
/// Used by tests, `#Preview`s, and the app's DEBUG `-fixtureScenario` launch argument (spec §7.4);
/// compiled out of Release.
public struct FixtureAPI: CIRadarAPI {
  /// The spec §6 states, named as `-fixtureScenario` takes them.
  public enum Scenario: String, CaseIterable, Sendable {
    case ranking
    case nothingFlaky = "nothing-flaky"
    case notIngested = "not-ingested"
    case loading
    case noRepos = "no-repos"
    case unreachable
  }

  public let scenario: Scenario

  public init(scenario: Scenario) {
    self.scenario = scenario
  }

  public func repos() async throws(APIError) -> [Repo] {
    switch scenario {
    case .ranking:
      return try fixture("repos.json", as: ReposResponse.self).repos
    case .nothingFlaky, .notIngested:
      // The repo in this state comes first, so it's selected at launch: screenshots can't click (spec §7.4).
      let repos = try fixture("repos.json", as: ReposResponse.self).repos
      let shown = try fixture("ranking-\(scenario.rawValue).json", as: Ranking.self).repo.id
      return repos.filter { $0.id == shown } + repos.filter { $0.id != shown }
    case .loading:
      try await neverAnswer()
    case .noRepos:
      return try fixture("repos-empty.json", as: ReposResponse.self).repos
    case .unreachable:
      throw .unreachable(underlying: URLError(.cannotConnectToHost))
    }
  }

  /// The ranking of a repo from `repos.json`, or the API's 404 for any other id. Each repo's
  /// `ranking-*.json` fixture is named for the spec §6 state it shows.
  public func ranking(repoID: Repo.ID) async throws(APIError) -> Ranking {
    switch scenario {
    case .ranking, .nothingFlaky, .notIngested:
      for name in Fixtures.names(withPrefix: "ranking-") {
        let ranking = try fixture(name, as: Ranking.self)
        if ranking.repo.id == repoID { return ranking }
      }
      throw notWatched(repoID)
    case .noRepos:
      throw notWatched(repoID)
    case .loading:
      try await neverAnswer()
    case .unreachable:
      throw .unreachable(underlying: URLError(.cannotConnectToHost))
    }
  }

  private func notWatched(_ repoID: Repo.ID) -> APIError {
    .server(status: 404, code: "repo_not_found", message: "Repo \(repoID) is not watched.")
  }

  private func fixture<Body: Decodable>(_ name: String, as _: Body.Type) throws(APIError) -> Body {
    do {
      return try JSONDecoder.ciRadar().decode(Body.self, from: Fixtures.data(named: name))
    } catch {
      throw .decoding("Fixture \(name): \(error)")
    }
  }

  /// The `loading` scenario: waits until its task is cancelled, then fails as unreachable.
  private func neverAnswer() async throws(APIError) -> Never {
    while !Task.isCancelled {
      try? await Task.sleep(for: .seconds(3600))
    }
    throw .unreachable(underlying: CancellationError())
  }
}

#endif
