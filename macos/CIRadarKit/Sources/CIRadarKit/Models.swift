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

/// A repo's ranking, as `GET /repos/:id/ranking` returns it (spec §3.3).
public struct Ranking: Decodable, Hashable, Sendable {
  public let repo: Repo
  /// The lookback window the ranking covers.
  public let daysBack: Int
  /// Most failures first, exactly as `rank()` ordered them. Never re-sort these.
  public let flaky: [RankedRow]
  /// Failing almost every run, in `rank()`'s order.
  public let broken: [RankedRow]

  public init(repo: Repo, daysBack: Int, flaky: [RankedRow], broken: [RankedRow]) {
    self.repo = repo
    self.daysBack = daysBack
    self.flaky = flaky
    self.broken = broken
  }
}

/// One ranked job, or one ranked test inside a job.
public struct RankedRow: Decodable, Hashable, Sendable {
  public enum Kind: Hashable, Sendable {
    case job
    case test(name: String)

    /// The row's tag: JOB or TEST.
    public var label: String {
      switch self {
      case .job: "JOB"
      case .test: "TEST"
      }
    }
  }

  public let kind: Kind
  public let workflowName: String
  public let jobName: String
  public let failures: Int
  public let runs: Int

  public init(kind: Kind, workflowName: String, jobName: String, failures: Int, runs: Int) {
    self.kind = kind
    self.workflowName = workflowName
    self.jobName = jobName
    self.failures = failures
    self.runs = runs
  }

  /// What the row is about: the test's name, or the job's.
  public var name: String {
    switch kind {
    case .job: jobName
    case .test(let name): name
    }
  }

  /// Where it runs: `workflow / job` for a test, the workflow for a job.
  public var location: String {
    switch kind {
    case .job: workflowName
    case .test: "\(workflowName) / \(jobName)"
    }
  }

  /// The share of runs that failed, from 0 to 1.
  public var failureRate: Double {
    Double(failures) / Double(runs)
  }

  private enum CodingKeys: String, CodingKey {
    case kind, workflowName, jobName, testName, failures, runs
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(String.self, forKey: .kind) {
    case "job":
      kind = .job
    case "test":
      kind = .test(name: try container.decode(String.self, forKey: .testName))
    case let other:
      throw DecodingError.dataCorruptedError(
        forKey: .kind, in: container, debugDescription: "Unknown row kind \"\(other)\"")
    }
    workflowName = try container.decode(String.self, forKey: .workflowName)
    jobName = try container.decode(String.self, forKey: .jobName)
    failures = try container.decode(Int.self, forKey: .failures)
    runs = try container.decode(Int.self, forKey: .runs)
  }
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
