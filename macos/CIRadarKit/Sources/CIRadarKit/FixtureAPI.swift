import Foundation

#if DEBUG

/// Serves a named scenario from the bundled contract fixtures, with no backend (spec §5.3).
/// Used by tests, `#Preview`s, and the app's DEBUG `-fixtureScenario` launch argument (spec §7.4);
/// compiled out of Release.
public struct FixtureAPI: CIRadarAPI {
  /// The spec §6 states this API can produce so far, named as `-fixtureScenario` takes them.
  public enum Scenario: String, CaseIterable, Sendable {
    case ranking
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
    case .loading:
      try await neverAnswer()
    case .noRepos:
      return []
    case .unreachable:
      throw .unreachable(underlying: URLError(.cannotConnectToHost))
    }
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
