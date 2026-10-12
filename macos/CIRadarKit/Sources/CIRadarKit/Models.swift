import Foundation

/// A watched repo, as `GET /repos` returns it (spec §3.3).
public struct Repo: Codable, Hashable, Identifiable, Sendable {
  public let id: Int
  public let owner: String
  public let name: String
  /// When CI Radar last ingested a job attempt for this repo; nil if never.
  public let latestDataAt: Date?
  public let flakyCount: Int
  public let brokenCount: Int

  public init(
    id: Int, owner: String, name: String, latestDataAt: Date?, flakyCount: Int, brokenCount: Int
  ) {
    self.id = id
    self.owner = owner
    self.name = name
    self.latestDataAt = latestDataAt
    self.flakyCount = flakyCount
    self.brokenCount = brokenCount
  }

  public var fullName: String { "\(owner)/\(name)" }

  /// The one status a repo shows: broken wins over flaky; nil when neither.
  public var status: RepoStatus? {
    if brokenCount > 0 { return .broken }
    if flakyCount > 0 { return .flaky }
    return nil
  }
}

public enum RepoStatus: Sendable {
  case flaky
  case broken
}

/// The body of `GET /repos`.
struct ReposResponse: Codable, Sendable {
  let repos: [Repo]
}

/// The body of every non-2xx API response.
struct ErrorBody: Codable, Sendable {
  struct Detail: Codable, Sendable {
    let code: String
    let message: String
  }

  let error: Detail
}

extension JSONDecoder {
  /// Decodes API bodies: ISO-8601 UTC timestamps.
  static func ciRadar() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }
}
